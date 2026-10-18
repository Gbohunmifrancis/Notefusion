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
        Assert.Equal("NoteFusion", root.GetProperty("customizations").GetProperty("title").GetString());
        // The page must not outlive the stale sweep's day.
        Assert.Equal(1440, root.GetProperty("configurations").GetProperty("session_duration").GetInt32());
    }

    [Fact]
    public async Task InitiateAsync_writes_a_zero_decimal_currency_in_whole_units()
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, """{"status":"success","data":{"link":"https://checkout.flutterwave.com/x"}}""");

        var result = await Gateway(handler, "UGX").InitiateAsync(Initiation("UGX"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        Assert.Equal("499", body.RootElement.GetProperty("amount").GetString());
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
    [InlineData("failed")]
    [InlineData("cancelled")]
    [InlineData("pending")]
    public async Task VerifyAsync_never_calls_an_unpaid_transaction_final(string flwStatus)
    {
        // Flutterwave keeps the page open after a declined card for another try, until the session ends; the
        // stale sweep closes what is still unpaid after that.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, Transaction(flwStatus));

        var result = await Gateway(handler).VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: "5566"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Succeeded);
        Assert.False(result.Value.Terminal);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, "No transaction was found for this id")]
    [InlineData(HttpStatusCode.NotFound, "Transaction not found")]
    public async Task VerifyAsync_reads_no_transaction_as_not_paid_yet(HttpStatusCode code, string message)
    {
        // A page opened and never paid: Flutterwave's answer, so the stale sweep can close the row in a day.
        var handler = StubHttpMessageHandler.Returning(
            code, JsonSerializer.Serialize(new { status = "error", message, data = (object?)null }));

        var result = await Gateway(handler).VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: null), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Succeeded);
        Assert.False(result.Value.Terminal);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, """{"status":"error","message":"Invalid authorization key"}""")]
    [InlineData(HttpStatusCode.NotFound, "Not Found")]
    [InlineData(HttpStatusCode.InternalServerError, """{"status":"error","message":"No transaction was found for this id"}""")]
    public async Task VerifyAsync_treats_any_other_refusal_as_no_answer(HttpStatusCode code, string body)
    {
        // A bad key or a wrong base URL says nothing about the payment, so the row is left for the next ask.
        var handler = StubHttpMessageHandler.Returning(code, body);

        var result = await Gateway(handler).VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: null), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task VerifyAsync_refuses_a_transaction_carrying_another_reference()
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, Transaction("successful", txRef: "NF_someone_else"));

        var result = await Gateway(handler).VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: "5566"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.NotEqual(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task VerifyAsync_will_not_fulfil_an_amount_it_cannot_read_exactly()
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, Transaction("successful", amount: 4.999m));

        var result = await Gateway(handler).VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: "5566"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task VerifyAsync_reads_a_zero_decimal_amount_in_whole_units()
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, Transaction("successful", amount: 18500m, currency: "UGX"));

        var result = await Gateway(handler, "UGX").VerifyAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: "5566"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(18500, result.Value.AmountMinor);
        Assert.Equal("UGX", result.Value.Currency);
    }

    // ------------------------------------------------------- What the page saw (CheckAsync)

    [Theory]
    [InlineData("failed", "card", CheckoutAttempt.Declined)]
    [InlineData("pending", "bank_transfer", CheckoutAttempt.TransferStarted)]
    [InlineData("pending", "card", CheckoutAttempt.None)]
    [InlineData("successful", "card", CheckoutAttempt.None)]
    public async Task CheckAsync_reads_what_the_page_saw(string flwStatus, string paymentType, CheckoutAttempt expected)
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, Transaction(flwStatus, paymentType: paymentType));

        var check = await Gateway(handler).CheckAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: "5566"), CancellationToken.None);

        Assert.True(check.Verification.IsSuccess);
        Assert.Equal(expected, check.Attempt);
    }

    [Fact]
    public async Task CheckAsync_sees_no_attempt_when_there_is_no_transaction()
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.BadRequest, """{"status":"error","message":"No transaction was found for this id","data":null}""");

        var check = await Gateway(handler).CheckAsync(
            new GatewayVerificationRequest(Reference, ProviderReference: null), CancellationToken.None);

        Assert.Equal(CheckoutAttempt.None, check.Attempt);
    }

    private static string Transaction(
        string status, string txRef = Reference, decimal amount = 4.99m, string currency = "USD", string paymentType = "card")
        => JsonSerializer.Serialize(new
        {
            status = "success",
            message = "Transaction fetched successfully",
            data = new { id = 5566, tx_ref = txRef, amount, currency, status, payment_type = paymentType }
        });

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
        Assert.Equal("flw:998877:successful", result.Value.ProviderEventId);
    }

    [Fact]
    public void FlutterwaveWebhookValidator_never_accepts_the_secret_key_in_place_of_the_hash()
    {
        var validator = new FlutterwaveWebhookValidator(new PaymentProviderOptions { SecretKey = "FLWSECK_TEST" });

        var result = validator.Validate(new WebhookRequest(
            """{"event":"charge.completed","data":{"id":1}}""",
            new Dictionary<string, string> { ["verif-hash"] = "FLWSECK_TEST" }));

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, result.Error.Type);
    }

    [Fact]
    public void FlutterwaveWebhookValidator_keeps_a_later_status_of_one_transaction_apart()
    {
        // Declined, then paid on the same page: the second event must not be dropped as a duplicate.
        var validator = new FlutterwaveWebhookValidator(new PaymentProviderOptions { WebhookSecret = "hash" });
        var headers = new Dictionary<string, string> { ["verif-hash"] = "hash" };

        var failed = validator.Validate(new WebhookRequest(
            """{"event":"charge.completed","data":{"id":42,"tx_ref":"NF_x","status":"failed"}}""", headers));
        var paid = validator.Validate(new WebhookRequest(
            """{"event":"charge.completed","data":{"id":42,"tx_ref":"NF_x","status":"successful"}}""", headers));

        Assert.NotEqual(failed.Value.ProviderEventId, paid.Value.ProviderEventId);
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
