using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Billing.Gateways;
using NoteFusion.Infrastructure.Billing.Webhooks;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

public class FlutterwavePaymentGatewayTests
{
    private const string Reference = "NF_flw_test_123";
    private const long AmountMinor = 499; // $4.99 -> 4.99 in FLW
    private const string WebhookSecret = "flw_secret_hash_value";

    private static FlutterwavePaymentGateway Gateway(StubHttpMessageHandler handler, string currencies = "USD,NGN")
        => new(
            new HttpClient(handler) { BaseAddress = new Uri("https://api.flutterwave.com") },
            new PaymentProviderOptions
            {
                SecretKey = "FLWSECK_TEST-123456",
                WebhookSecret = WebhookSecret,
                BaseUrl = "https://api.flutterwave.com",
                SupportedCurrencies = currencies
            },
            NullLogger<FlutterwavePaymentGateway>.Instance);

    private static GatewayInitiationRequest Initiation(string currency = "USD") => new(
        Reference, AmountMinor, currency, "jane@example.com",
        "https://notefusion-api.herokuapp.com/api/billing/return",
        Recurring: true, IdempotencyKey: $"checkout:{Reference}", PlanCode: "pro_monthly", CustomerName: "Jane Doe");

    // ------------------------------------------------------- Initiation Tests

    [Fact]
    public async Task InitiateAsync_converts_minor_to_major_units_and_returns_checkout_link()
    {
        var flwResponse = JsonSerializer.Serialize(new
        {
            status = "success",
            message = "Hosted Link",
            data = new
            {
                link = "https://checkout.flutterwave.com/v3/hosted/pay/test12345"
            }
        });

        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, flwResponse);
        var gateway = Gateway(handler);

        var result = await gateway.InitiateAsync(Initiation("USD"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("https://checkout.flutterwave.com/v3/hosted/pay/test12345", result.Value.CheckoutUrl);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("/v3/payments", request.Uri!.AbsolutePath);

        using var body = JsonDocument.Parse(request.Body!);
        var root = body.RootElement;
        Assert.Equal("4.99", root.GetProperty("amount").GetString());
        Assert.Equal("USD", root.GetProperty("currency").GetString());
        Assert.Equal(Reference, root.GetProperty("tx_ref").GetString());
        Assert.Equal("jane@example.com", root.GetProperty("customer").GetProperty("email").GetString());
    }

    [Fact]
    public async Task InitiateAsync_returns_network_error_when_gateway_unreachable()
    {
        var handler = StubHttpMessageHandler.Throwing(new HttpRequestException("Connection timed out"));
        var gateway = Gateway(handler);

        var result = await gateway.InitiateAsync(Initiation("USD"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.BadGateway)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task InitiateAsync_treats_5xx_as_retryable_network_errors(HttpStatusCode status)
    {
        var handler = StubHttpMessageHandler.Returning(status, """{"status":"error","message":"Downstream failure"}""");
        var gateway = Gateway(handler);

        var result = await gateway.InitiateAsync(Initiation("USD"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    // ------------------------------------------------------- Verification Tests

    [Fact]
    public async Task VerifyAsync_by_provider_reference_parses_status_and_converts_major_to_minor()
    {
        var flwVerifyResponse = JsonSerializer.Serialize(new
        {
            status = "success",
            message = "Transaction fetched successfully",
            data = new
            {
                id = 987654,
                tx_ref = Reference,
                flw_ref = "FLW-MOCK-12345",
                amount = 4.99m,
                currency = "USD",
                status = "successful"
            }
        });

        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, flwVerifyResponse);
        var gateway = Gateway(handler);

        var result = await gateway.VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: "987654"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Succeeded);
        Assert.Equal(499, result.Value.AmountMinor);
        Assert.Equal("USD", result.Value.Currency);
        Assert.Equal("987654", result.Value.ProviderReference);

        var request = Assert.Single(handler.Requests);
        Assert.Equal("/v3/transactions/987654/verify", request.Uri!.AbsolutePath);
    }

    [Fact]
    public async Task VerifyAsync_by_tx_ref_when_provider_reference_not_numeric()
    {
        var flwVerifyResponse = JsonSerializer.Serialize(new
        {
            status = "success",
            data = new
            {
                id = 112233,
                tx_ref = Reference,
                amount = 1000m,
                currency = "NGN",
                status = "successful"
            }
        });

        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, flwVerifyResponse);
        var gateway = Gateway(handler);

        var result = await gateway.VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: null),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Succeeded);
        Assert.Equal(100000, result.Value.AmountMinor);
        Assert.Equal("NGN", result.Value.Currency);

        var request = Assert.Single(handler.Requests);
        Assert.Equal("/v3/transactions/verify_by_reference", request.Uri!.AbsolutePath);
        Assert.Equal($"?tx_ref={Reference}", request.Uri.Query);
    }

    [Theory]
    [InlineData("failed", true)]
    [InlineData("cancelled", true)]
    [InlineData("pending", false)]
    public async Task VerifyAsync_correctly_flags_terminal_statuses(string flwStatus, bool expectedTerminal)
    {
        var flwVerifyResponse = JsonSerializer.Serialize(new
        {
            status = "success",
            data = new
            {
                id = 5566,
                tx_ref = Reference,
                amount = 10m,
                currency = "USD",
                status = flwStatus
            }
        });

        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, flwVerifyResponse);
        var gateway = Gateway(handler);

        var result = await gateway.VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: "5566"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Succeeded);
        Assert.Equal(expectedTerminal, result.Value.Terminal);
    }

    // ------------------------------------------------------- Webhook Validator Tests

    [Fact]
    public void FlutterwaveWebhookValidator_validates_correct_verif_hash()
    {
        var validator = new FlutterwaveWebhookValidator(new PaymentProviderOptions
        {
            SecretKey = "FLWSECK_TEST",
            WebhookSecret = "my_custom_verif_hash"
        });

        var rawJson = JsonSerializer.Serialize(new
        {
            @event = "charge.completed",
            data = new
            {
                id = 998877,
                tx_ref = Reference,
                status = "successful",
                amount = 50
            }
        });

        var headers = new Dictionary<string, string>
        {
            ["verif-hash"] = "my_custom_verif_hash"
        };

        var result = validator.Validate(new WebhookRequest(rawJson, headers));

        Assert.True(result.IsSuccess);
        Assert.Equal("charge.completed", result.Value.EventType);
        Assert.Equal(Reference, result.Value.PaymentReference);
        Assert.Equal("flw:998877", result.Value.ProviderEventId);
    }

    [Fact]
    public void FlutterwaveWebhookValidator_rejects_missing_or_invalid_hash()
    {
        var validator = new FlutterwaveWebhookValidator(new PaymentProviderOptions
        {
            SecretKey = "FLWSECK_TEST",
            WebhookSecret = "my_custom_verif_hash"
        });

        var rawJson = """{"event":"charge.completed","data":{"id":123}}""";

        var missing = validator.Validate(new WebhookRequest(rawJson, new Dictionary<string, string>()));
        Assert.True(missing.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, missing.Error.Type);

        var badHash = validator.Validate(new WebhookRequest(rawJson, new Dictionary<string, string>
        {
            ["verif-hash"] = "wrong_hash"
        }));
        Assert.True(badHash.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, badHash.Error.Type);
    }
}
