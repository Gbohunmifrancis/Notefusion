using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.Tokens;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Infrastructure.Billing.GooglePlay;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The Google Play Developer API adapter: what it reads out of Google's answers, how it signs in as the service
/// account, how it treats Google's refusals, and which Pub/Sub pushes it believes.
/// </summary>
public class GooglePlayClientTests
{
    private static readonly DateTime Now = new(2026, 10, 18, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void A_subscription_is_read_from_its_first_line_item()
    {
        const string raw = """
        {
          "kind": "androidpublisher#subscriptionPurchaseV2",
          "regionCode": "NG",
          "startTime": "2026-10-18T11:59:00.120Z",
          "subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
          "latestOrderId": "GPA.3333-4137-0319-36762",
          "linkedPurchaseToken": "old-token",
          "acknowledgementState": "ACKNOWLEDGEMENT_STATE_PENDING",
          "externalAccountIdentifiers": { "obfuscatedExternalAccountId": "4f9c0b4bd1e94c4ba5a1f4b3b1c2d3e4" },
          "lineItems": [{
            "productId": "pro",
            "expiryTime": "2026-11-18T11:59:00.120Z",
            "autoRenewingPlan": { "autoRenewEnabled": true, "recurringPrice": { "currencyCode": "NGN", "units": "7500" } },
            "offerDetails": { "basePlanId": "monthly", "offerTags": [] },
            "latestSuccessfulOrderId": "GPA.3333-4137-0319-36762"
          }]
        }
        """;

        var s = GooglePlayClient.ParseSubscription(raw).Value;

        Assert.Equal("SUBSCRIPTION_STATE_ACTIVE", s.State);
        Assert.Equal("pro", s.ProductId);
        Assert.Equal("monthly", s.BasePlanId);
        Assert.Equal(new DateTime(2026, 11, 18, 11, 59, 0, 120, DateTimeKind.Utc), s.ExpiryUtc);
        Assert.Equal(DateTimeKind.Utc, s.ExpiryUtc!.Value.Kind);
        Assert.True(s.AutoRenewing);
        Assert.Equal("GPA.3333-4137-0319-36762", s.LatestSuccessfulOrderId);
        Assert.Equal("old-token", s.LinkedPurchaseToken);
        Assert.Equal("4f9c0b4bd1e94c4ba5a1f4b3b1c2d3e4", s.AccountId);
        Assert.False(s.Acknowledged);
        Assert.Equal("NG", s.RegionCode);
    }

    [Theory]
    [InlineData(0, "PURCHASED")]
    [InlineData(1, "CANCELED")]
    [InlineData(2, "PENDING")]
    public void A_one_time_purchase_reads_googles_numbered_states(int purchaseState, string expected)
    {
        var raw = JsonSerializer.Serialize(new
        {
            purchaseState, consumptionState = 1, acknowledgementState = 1, orderId = "GPA.1", regionCode = "GH",
            obfuscatedExternalAccountId = "abc"
        });

        var p = GooglePlayClient.ParseOneTime(raw).Value;

        Assert.Equal(expected, p.State);
        Assert.True(p.Consumed);
        Assert.True(p.Acknowledged);
        Assert.Equal("GPA.1", p.OrderId);
        Assert.Equal("abc", p.AccountId);
    }

    [Theory]
    [InlineData("""{"state":"PROCESSED","total":{"currencyCode":"USD","units":"9","nanos":990000000}}""", 999, "USD")]
    [InlineData("""{"state":"PROCESSED","total":{"currencyCode":"NGN","units":"8062","nanos":500000000}}""", 806250, "NGN")]
    [InlineData("""{"state":"REFUNDED","total":{"currencyCode":"UGX","units":"18500"}}""", 18500, "UGX")]
    public void An_orders_total_is_read_in_the_currencys_own_minor_units(string raw, long minor, string currency)
    {
        var order = GooglePlayClient.ParseOrder(raw)!;

        Assert.Equal(minor, order.TotalMinor);
        Assert.Equal(currency, order.Currency);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Gone)]
    [InlineData(HttpStatusCode.BadRequest)]
    public async Task A_token_google_does_not_know_is_not_found(HttpStatusCode status)
    {
        var (client, _) = Client(StubHttpMessageHandler.Returning(status, """{"error":{"message":"The purchase token was not found."}}"""));

        var result = await client.GetSubscriptionAsync("t", CancellationToken.None);

        Assert.Equal(BillingErrors.PlayPurchaseNotFound, result.Error);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task Any_other_refusal_is_no_answer_and_asked_again(HttpStatusCode status)
    {
        var (client, _) = Client(StubHttpMessageHandler.Returning(status, "{}"));

        var result = await client.GetSubscriptionAsync("t", CancellationToken.None);

        Assert.Equal(BillingErrors.PlayUnavailable, result.Error);
    }

    [Fact]
    public async Task Calls_go_to_the_apps_package_with_the_service_accounts_token()
    {
        var api = StubHttpMessageHandler.Returning(HttpStatusCode.OK, "{}");
        var (client, _) = Client(api);

        await client.AcknowledgeSubscriptionAsync("pro", "tok/en", CancellationToken.None);

        var request = Assert.Single(api.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(
            "/androidpublisher/v3/applications/com.notefusion.com/purchases/subscriptions/pro/tokens/tok%2Fen:acknowledge",
            request.Uri!.AbsolutePath);
        Assert.Equal("Bearer access-1", request.Headers["Authorization"]);
    }

    [Fact]
    public void The_token_request_is_signed_by_the_service_account_for_the_play_scope()
    {
        using var rsa = RSA.Create(2048);
        var key = new GooglePlayAccessTokens.ServiceAccountKey("play@notefusion.iam.gserviceaccount.com",
            rsa.ExportPkcs8PrivateKeyPem(), "https://oauth2.googleapis.com/token");

        var assertion = GooglePlayAccessTokens.Assertion(key, Now);

        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        var principal = handler.ValidateToken(assertion, new TokenValidationParameters
        {
            ValidIssuer = key.ClientEmail,
            ValidAudience = "https://oauth2.googleapis.com/token",
            IssuerSigningKey = new RsaSecurityKey(rsa.ExportParameters(false)),
            ValidateLifetime = false,
        }, out var token);
        Assert.Equal("https://www.googleapis.com/auth/androidpublisher", principal.FindFirst("scope")!.Value);
        Assert.Equal(SecurityAlgorithms.RsaSha256, ((JwtSecurityToken)token).Header.Alg);
    }

    [Fact]
    public void A_key_given_as_base64_reads_the_same_as_the_raw_json()
    {
        const string json = """{"client_email":"a@b.iam.gserviceaccount.com","private_key":"x"}""";
        var options = new GooglePlayOptions { ServiceAccountJson = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(json)) };

        Assert.Equal(json, options.ServiceAccountJsonText());
        Assert.Equal("a@b.iam.gserviceaccount.com", GooglePlayAccessTokens.ServiceAccountKey.Read(options.ServiceAccountJsonText())!.ClientEmail);
    }

    // ---------------------------------------------------------------- Pub/Sub push tokens

    [Theory]
    [InlineData("push@notefusion.iam.gserviceaccount.com", "true", "https://api.notefusion.studio/api/billing/google-play/notifications", true)]
    [InlineData("someone@else.iam.gserviceaccount.com", "true", "https://api.notefusion.studio/api/billing/google-play/notifications", false)]
    [InlineData("push@notefusion.iam.gserviceaccount.com", "false", "https://api.notefusion.studio/api/billing/google-play/notifications", false)]
    [InlineData("push@notefusion.iam.gserviceaccount.com", "true", "https://elsewhere.example/hook", false)]
    public void Only_our_push_accounts_token_for_our_endpoint_is_believed(string email, string verified, string audience, bool expected)
    {
        using var rsa = RSA.Create(2048);
        var signing = new RsaSecurityKey(rsa);
        var verifier = new PubSubPushVerifier(new GooglePlayOptions
        {
            PushAudience = "https://api.notefusion.studio/api/billing/google-play/notifications",
            PushServiceAccount = "push@notefusion.iam.gserviceaccount.com"
        }, NullLogger<PubSubPushVerifier>.Instance);
        var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            issuer: "https://accounts.google.com", audience: audience,
            claims: [new Claim("email", email), new Claim("email_verified", verified, ClaimValueTypes.Boolean)],
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: new SigningCredentials(signing, SecurityAlgorithms.RsaSha256)));

        var accepted = verifier.Accepts(token, new TokenValidationParameters
        {
            ValidIssuers = ["accounts.google.com", "https://accounts.google.com"],
            ValidAudience = "https://api.notefusion.studio/api/billing/google-play/notifications",
            IssuerSigningKey = signing,
        });

        Assert.Equal(expected, accepted);
    }

    [Fact]
    public async Task Without_its_settings_no_push_is_believed()
    {
        var verifier = new PubSubPushVerifier(new GooglePlayOptions(), NullLogger<PubSubPushVerifier>.Instance);

        Assert.False(await verifier.VerifyAsync("Bearer anything", CancellationToken.None));
    }

    private static (GooglePlayClient Client, StubHttpMessageHandler Token) Client(StubHttpMessageHandler api)
    {
        var tokenEndpoint = StubHttpMessageHandler.Returning(HttpStatusCode.OK, """{"access_token":"access-1","expires_in":3600}""");
        // A key is needed to sign the token request; any RSA key does for a stubbed endpoint.
        using var rsa = RSA.Create(2048);
        var withKey = new GooglePlayOptions
        {
            ServiceAccountJson = JsonSerializer.Serialize(new { client_email = "play@x.iam.gserviceaccount.com", private_key = rsa.ExportPkcs8PrivateKeyPem() })
        };
        var tokens = new GooglePlayAccessTokens(new SingleClientFactory(tokenEndpoint), withKey, new FixedClock(Now),
            NullLogger<GooglePlayAccessTokens>.Instance);
        var client = new GooglePlayClient(
            new HttpClient(api) { BaseAddress = new Uri("https://androidpublisher.googleapis.com") }, tokens, withKey,
            NullLogger<GooglePlayClient>.Instance);
        return (client, tokenEndpoint);
    }

    private sealed class SingleClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}
