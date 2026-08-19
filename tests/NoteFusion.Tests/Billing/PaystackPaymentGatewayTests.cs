using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Billing.Gateways;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The Paystack adapter, exercised against a scripted HTTP handler. The tests are dominated by one rule,
/// because breaking it is how this adapter previously took money it could not honour: <b>the charge must
/// be the plan's amount in the plan's currency, or there must be no charge at all.</b>
/// <para>
/// The adapter used to answer Paystack's <c>403 Currency not supported by merchant</c> by re-sending the
/// request with the amount multiplied by a hard-coded 1500 and the currency omitted, so a $4.99 plan
/// became a ₦7,485 charge. Fulfilment compares the settled charge against the transaction row, so that
/// payment succeeded at the provider and was then refused here — the customer paid and got nothing. The
/// first two tests exist so no future "fallback" can reintroduce that.
/// </para>
/// <para>
/// The rest hold the transient/terminal line, which has opposite failure modes either way: a refusal
/// reported as transient parks the transaction Pending and the user waits for a checkout that will never
/// open, while an unknown outcome reported as terminal can strand someone who has already paid.
/// </para>
/// </summary>
public class PaystackPaymentGatewayTests
{
    private const string Reference = "NF_7d4c";
    private const long AmountMinor = 499;

    private static PaystackPaymentGateway Gateway(StubHttpMessageHandler handler, string currencies = "USD,NGN")
        => new(
            new HttpClient(handler) { BaseAddress = new Uri("https://api.paystack.co") },
            new PaymentProviderOptions
            {
                SecretKey = "sk_test_key",
                BaseUrl = "https://api.paystack.co",
                SupportedCurrencies = currencies,
            },
            NullLogger<PaystackPaymentGateway>.Instance);

    private static GatewayInitiationRequest Initiation(string currency = "USD") => new(
        Reference, AmountMinor, currency, "jane@example.com",
        "https://notefusion-api.herokuapp.com/api/billing/return",
        Recurring: true, IdempotencyKey: $"checkout:{Reference}", PlanCode: "pro_monthly", CustomerName: "Jane Doe");

    private static string InitializedResponse() => JsonSerializer.Serialize(new
    {
        status = true,
        message = "Authorization URL created",
        data = new
        {
            authorization_url = "https://checkout.paystack.com/7wczcv8ndh2opo2",
            access_code = "7wczcv8ndh2opo2",
            reference = Reference,
        },
    });

    /// <summary>Paystack's real reply when the integration is not enabled for the requested currency.</summary>
    private static string CurrencyNotSupported() => JsonSerializer.Serialize(new
    {
        status = false,
        message = "Currency not supported by merchant",
    });

    // ------------------------------------------------------- the money must not be reinterpreted

    [Fact]
    public async Task A_currency_the_merchant_cannot_take_is_refused_outright_and_never_retried_in_another_currency()
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Forbidden, CurrencyNotSupported());

        var result = await Gateway(handler).InitiateAsync(Initiation("USD"), CancellationToken.None);

        Assert.True(result.IsFailure);

        // Exactly one request: no second attempt at a converted amount, in a currency the account does
        // happen to accept. A charge the transaction row does not recognise cannot be fulfilled, so
        // opening one would take the customer's money for a subscription they can never be granted.
        var request = Assert.Single(handler.Requests);
        using var body = JsonDocument.Parse(request.Body!);
        Assert.Equal(AmountMinor, body.RootElement.GetProperty("amount").GetInt64());
        Assert.Equal("USD", body.RootElement.GetProperty("currency").GetString());
    }

    [Fact]
    public async Task A_refusal_is_terminal_so_the_transaction_fails_loudly_instead_of_parking_as_pending()
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Forbidden, CurrencyNotSupported());

        var result = await Gateway(handler).InitiateAsync(Initiation("USD"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Validation, result.Error.Type);

        // The reason has to survive into the error, or the deployment is left guessing at a config problem.
        Assert.Contains("Currency not supported by merchant", result.Error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_charge_is_the_plan_amount_in_the_plan_currency_with_our_reference()
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, InitializedResponse());

        var result = await Gateway(handler).InitiateAsync(Initiation("NGN"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("https://checkout.paystack.com/7wczcv8ndh2opo2", result.Value.CheckoutUrl);
        Assert.Equal("7wczcv8ndh2opo2", result.Value.ProviderReference);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("/transaction/initialize", request.Uri!.AbsolutePath);

        using var body = JsonDocument.Parse(request.Body!);
        Assert.Equal(AmountMinor, body.RootElement.GetProperty("amount").GetInt64());
        Assert.Equal("NGN", body.RootElement.GetProperty("currency").GetString());

        // The reference is the only key that later verifies this payment.
        Assert.Equal(Reference, body.RootElement.GetProperty("reference").GetString());
    }

    // ------------------------------------------------------- transient vs terminal

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.BadGateway)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.RequestTimeout)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    public async Task A_status_that_leaves_the_outcome_unknown_stays_retryable(HttpStatusCode status)
    {
        var handler = StubHttpMessageHandler.Returning(status, """{"status":false,"message":"try again"}""");

        var result = await Gateway(handler).InitiateAsync(Initiation("NGN"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task A_refusal_on_the_merits_is_terminal(HttpStatusCode status)
    {
        var handler = StubHttpMessageHandler.Returning(status, """{"status":false,"message":"nope"}""");

        var result = await Gateway(handler).InitiateAsync(Initiation("NGN"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Validation, result.Error.Type);
    }

    [Fact]
    public async Task An_unreachable_provider_is_transient_not_a_decline()
    {
        var handler = StubHttpMessageHandler.Throwing(new HttpRequestException("connection reset"));

        var result = await Gateway(handler).InitiateAsync(Initiation("NGN"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task A_success_without_a_checkout_url_is_not_treated_as_a_usable_checkout()
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, """{"status":true,"message":"ok","data":{"access_code":"abc"}}""");

        var result = await Gateway(handler).InitiateAsync(Initiation("NGN"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    // ------------------------------------------------------- verification

    [Fact]
    public async Task Verification_reports_the_settled_amount_and_currency_verbatim()
    {
        // Reported verbatim precisely so the caller's amount gate can catch a charge that disagrees with
        // the plan. Normalising either field here would defeat the only check that stands between a
        // mispriced charge and a granted subscription.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            status = true,
            data = new
            {
                status = "success",
                amount = 748500,
                currency = "NGN",
                id = 302961,
                authorization = new { authorization_code = "AUTH_72btv547" },
            },
        }));

        var result = await Gateway(handler).VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: null), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Succeeded);
        Assert.True(result.Value.Terminal);
        Assert.Equal(748500, result.Value.AmountMinor);
        Assert.Equal("NGN", result.Value.Currency);
        Assert.Equal("AUTH_72btv547", result.Value.ProviderSubscriptionRef);

        var request = Assert.Single(handler.Requests);
        Assert.Equal($"/transaction/verify/{Reference}", request.Uri!.AbsolutePath);
    }

    [Theory]
    [InlineData("failed")]
    [InlineData("abandoned")]
    [InlineData("reversed")]
    public async Task Only_success_counts_as_paid(string status)
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            status = true,
            data = new { status, amount = AmountMinor, currency = "NGN", id = 1 },
        }));

        var result = await Gateway(handler).VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: null), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Succeeded);
    }

    [Theory]
    // Dead for good: the caller may close the transaction and let the user start over.
    [InlineData("failed", true)]
    [InlineData("reversed", true)]
    // Still payable. A Paystack checkout link survives the customer walking away, so calling any of these
    // final would retire a session they can still complete — and the next attempt would open a second
    // charge beside it, which is the duplicate this whole flow exists to avoid.
    [InlineData("abandoned", false)]
    [InlineData("pending", false)]
    [InlineData("ongoing", false)]
    [InlineData("queued", false)]
    public async Task Only_a_status_that_can_never_become_a_success_is_reported_as_final(string status, bool terminal)
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            status = true,
            data = new { status, amount = AmountMinor, currency = "NGN", id = 1 },
        }));

        var result = await Gateway(handler).VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: null), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Succeeded);
        Assert.Equal(terminal, result.Value.Terminal);
    }

    [Fact]
    public async Task An_unreadable_verification_is_never_reported_as_a_decline()
    {
        // The dangerous direction: telling the caller "not paid" when we simply could not ask would strand
        // a customer whose card has already been charged.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.ServiceUnavailable, "<html>502</html>");

        var result = await Gateway(handler).VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: null), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }
}
