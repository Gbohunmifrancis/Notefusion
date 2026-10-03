using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Billing.Gateways;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The Bachs adapter, exercised against a scripted HTTP handler. Two themes run through these tests.
/// <para>
/// First, what we SEND: a subscription only exists because the cart holds a recurring catalog product,
/// and a retry is only safe because the same idempotency key travels with a byte-identical body. Those
/// are asserted on the captured request, not inferred from a happy-path result.
/// </para>
/// <para>
/// Second, and more important, the three-way classification of what comes back. "Did not succeed" and
/// "could not be determined" are different answers with opposite consequences: the caller treats a
/// non-success as final and stops asking, so an unreadable reply reported as a decline would strand a
/// customer who has already paid, while a definite refusal reported as transient would spin forever.
/// Most of the cases below exist to hold that line.
/// </para>
/// </summary>
public class BachsPaymentGatewayTests
{
    private const string PlanCode = "pro_monthly";
    private const string ProductId = "prod_abc123";
    private const string Reference = "NF_7d4c";
    private const string CheckoutId = "chk_9f2b";

    private static BachsOptions Options() => new()
    {
        BaseUrl = "https://sandbox-api.bachs.io",
        SecretKey = "sk_sandbox_key",
        WebhookSecret = "whsec_test_secret",
        ProductMap = new Dictionary<string, string> { [PlanCode] = ProductId },
    };

    private static BachsPaymentGateway Gateway(StubHttpMessageHandler handler, BachsOptions? options = null)
        => new(
            new HttpClient(handler) { BaseAddress = new Uri("https://sandbox-api.bachs.io") },
            options ?? Options(),
            NullLogger<BachsPaymentGateway>.Instance);

    private static GatewayInitiationRequest Initiation(string planCode = PlanCode) => new(
        Reference, 2900, "USD", "jane@example.com", "https://notefusion.studio/billing/success",
        Recurring: true, IdempotencyKey: $"checkout:{Reference}", planCode, CustomerName: "Jane Doe");

    private static string CreatedResponse(string? reference = Reference) => JsonSerializer.Serialize(new
    {
        checkout_id = CheckoutId,
        checkout_url = "https://checkout.bachs.io/c/chk_9f2b",
        status = "open",
        reference,
    });

    // ---------------------------------------------------------------- initiation

    [Fact]
    public async Task Initiation_sends_a_single_recurring_product_and_our_reference()
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Created, CreatedResponse());

        var result = await Gateway(handler).InitiateAsync(Initiation(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("https://checkout.bachs.io/c/chk_9f2b", result.Value.CheckoutUrl);

        // The checkout id must come back: it is the only key that can ever verify this payment.
        Assert.Equal(CheckoutId, result.Value.ProviderReference);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("/v1/checkout-sessions", request.Uri!.AbsolutePath);

        using var body = JsonDocument.Parse(request.Body!);
        var root = body.RootElement;

        var cart = root.GetProperty("product_cart");
        Assert.Equal(1, cart.GetArrayLength()); // "a subscription checkout needs exactly one product"
        Assert.Equal(ProductId, cart[0].GetProperty("product_id").GetString());
        Assert.Equal(1, cart[0].GetProperty("quantity").GetInt32());

        Assert.Equal(Reference, root.GetProperty("reference").GetString());
        Assert.Equal("USD", root.GetProperty("billing_currency").GetString());
        Assert.Equal("jane@example.com", root.GetProperty("customer").GetProperty("email").GetString());
        Assert.Equal("Jane Doe", root.GetProperty("customer").GetProperty("name").GetString());

        // Subscriptions are card-only; offering another method is a documented 400.
        Assert.Equal("card", root.GetProperty("allowed_payment_method_types")[0].GetString());

        // No raw amount: the price lives in the Bachs catalog, and sending one would make the checkout
        // a one-off charge instead of a subscription.
        Assert.False(root.TryGetProperty("amount", out _));
        Assert.False(root.TryGetProperty("pricing", out _));
    }

    [Fact]
    public async Task Initiation_carries_the_callers_idempotency_key_unchanged()
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Created, CreatedResponse());

        await Gateway(handler).InitiateAsync(Initiation(), CancellationToken.None);

        var request = Assert.Single(handler.Requests);
        Assert.Equal($"checkout:{Reference}", request.Headers["Idempotency-Key"]);
    }

    [Fact]
    public async Task Two_attempts_with_the_same_input_send_byte_identical_bodies()
    {
        // Bachs fingerprints an idempotent request on method + path + body, so a body that varies
        // between attempts is rejected as a conflict instead of replaying the original session — which
        // would leave us unable to reach a checkout the customer may already have paid.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Created, CreatedResponse());
        var gateway = Gateway(handler);

        await gateway.InitiateAsync(Initiation(), CancellationToken.None);
        await gateway.InitiateAsync(Initiation(), CancellationToken.None);

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(handler.Requests[0].Body, handler.Requests[1].Body);
    }

    [Fact]
    public async Task A_blank_customer_name_falls_back_rather_than_sending_nothing()
    {
        // Bachs' schema requires a name. A user with no profile name is ordinary, and a 400 there would
        // block the upgrade outright.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Created, CreatedResponse());

        await Gateway(handler).InitiateAsync(Initiation() with { CustomerName = "  " }, CancellationToken.None);

        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        Assert.Equal("jane", body.RootElement.GetProperty("customer").GetProperty("name").GetString());
    }

    [Fact]
    public async Task An_unmapped_plan_fails_terminally_without_contacting_bachs()
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Created, CreatedResponse());

        var result = await Gateway(handler).InitiateAsync(Initiation("pro_yearly"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Validation, result.Error.Type); // terminal: retrying cannot map a product
        Assert.Empty(handler.Requests);
    }

    // ------------------------------------------------------------ one-off (lifetime)

    [Fact]
    public async Task A_one_off_sends_a_raw_price_and_no_cart()
    {
        // The pricing source IS the mode, and Bachs never says so: a cart yields mode "subscription", a
        // raw `pricing` yields mode "payment". Sending a cart for a lifetime purchase would open a
        // recurring session — on this account an unpayable one, with an empty method list and HTTP 201.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Created, CreatedResponse());

        var result = await Gateway(handler).InitiateAsync(
            Initiation() with { Recurring = false }, CancellationToken.None);

        Assert.True(result.IsSuccess);

        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        var root = body.RootElement;

        var pricing = root.GetProperty("pricing");
        Assert.Equal("29.00", pricing.GetProperty("amount").GetString()); // 2900 minor → major string
        Assert.Equal("USD", pricing.GetProperty("currency").GetString());

        // Both sources in one body is refused outright ("Provide exactly one pricing source"), so this is
        // not cosmetic — it is the difference between a checkout and a 400.
        Assert.False(root.TryGetProperty("product_cart", out _));

        // The currency is already stated inside `pricing`; repeating it as `billing_currency` (which
        // exists to pin a multi-currency CATALOG product) is redundant at best.
        Assert.False(root.TryGetProperty("billing_currency", out _));

        // The card-only restriction is a property of subscriptions. Imposing it on a one-off would hide
        // bank transfer, mobile money and crypto — on this account, every method that actually works.
        Assert.False(root.TryGetProperty("allowed_payment_method_types", out _));
    }

    [Fact]
    public async Task A_one_off_needs_no_catalog_product()
    {
        // A lifetime plan has no Bachs product and never will: a product exists to carry a billing_cycle.
        // Demanding a mapping here would refuse a charge Bachs would have taken happily.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Created, CreatedResponse());

        var result = await Gateway(handler).InitiateAsync(
            Initiation("pro_lifetime") with { Recurring = false }, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public void An_empty_product_map_does_not_switch_the_provider_off()
    {
        // A lifetime-only deployment legitimately maps no products. Gating IsConfigured on the map would
        // silently deselect Bachs and strand every currency routed to it.
        var options = Options();
        var lifetimeOnly = new BachsOptions
        {
            BaseUrl = options.BaseUrl,
            SecretKey = options.SecretKey,
            WebhookSecret = options.WebhookSecret,
        };

        Assert.Empty(lifetimeOnly.ProductMap);
        Assert.True(lifetimeOnly.IsConfigured);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task A_definite_refusal_is_terminal(HttpStatusCode status)
    {
        // Nothing was charged and nothing will change on a retry, so the caller may safely tell the user
        // the upgrade failed.
        var handler = StubHttpMessageHandler.Returning(
            status, """{"detail":"Product is not recurring","error_code":"VALIDATION_ERROR"}""");

        var result = await Gateway(handler).InitiateAsync(Initiation(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.NotEqual(ErrorType.Network, result.Error.Type);
        Assert.Contains("VALIDATION_ERROR", result.Error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.BadGateway)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.RequestTimeout)]
    // 409 means our key was reused with a different body: the ORIGINAL session may be alive and paid, so
    // burning the transaction would retire the only key that can still reach it.
    [InlineData(HttpStatusCode.Conflict)]
    public async Task A_reply_that_leaves_the_outcome_unknown_stays_transient(HttpStatusCode status)
    {
        var handler = StubHttpMessageHandler.Returning(status, """{"detail":"nope","error_code":"CONFLICT"}""");

        var result = await Gateway(handler).InitiateAsync(Initiation(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Theory]
    // Bachs documents three different 201 shapes for this one endpoint. A reply missing the id cannot be
    // verified later, so we refuse to send the user to it — but transiently, because a session may exist.
    [InlineData("""{"checkout_url":"https://checkout.bachs.io/c/chk_9f2b","status":"open"}""")]
    [InlineData("""{"checkout_id":"chk_9f2b","status":"open"}""")]
    [InlineData("{}")]
    [InlineData("not json")]
    public async Task A_created_response_we_cannot_use_is_transient(string body)
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Created, body);

        var result = await Gateway(handler).InitiateAsync(Initiation(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task A_created_response_echoing_someone_elses_reference_is_refused()
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Created, CreatedResponse("NF_someone_else"));

        var result = await Gateway(handler).InitiateAsync(Initiation(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Failure, result.Error.Type);
    }

    [Fact]
    public async Task A_null_echoed_reference_is_tolerated()
    {
        // Documented as nullable, and the response is already bound to our request.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.Created, CreatedResponse(reference: null));

        Assert.True((await Gateway(handler).InitiateAsync(Initiation(), CancellationToken.None)).IsSuccess);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task A_connection_that_never_completes_is_transient(bool timeout)
    {
        // The single most dangerous case: the request may well have opened a session and debited the
        // customer. Anything but "unknown" here risks either a duplicate charge or a stranded payment.
        Exception error = timeout
            ? new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout")
            : new HttpRequestException("Connection reset");
        var handler = StubHttpMessageHandler.Throwing(error);

        var result = await Gateway(handler).InitiateAsync(Initiation(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    // ---------------------------------------------------------------- verification

    private static string SessionResponse(
        string status = "completed",
        string? paymentStatus = "succeeded",
        string? amount = "29.00",
        string? currency = "USD",
        string? reference = Reference,
        string? subscriptionId = "sub_123") => JsonSerializer.Serialize(new
        {
            checkout_id = CheckoutId,
            status,
            payment_status = paymentStatus,
            amount,
            currency,
            reference,
            charge = new { payment_id = "pay_777", subscription_id = subscriptionId },
        });

    private static GatewayVerificationRequest Verification(string? providerReference = CheckoutId)
        => new(Reference, providerReference);

    [Fact]
    public async Task A_completed_checkout_verifies_with_the_amount_in_minor_units()
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, SessionResponse());

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Succeeded);
        Assert.True(result.Value.Terminal);
        Assert.Equal(2900, result.Value.AmountMinor); // "29.00" major → 2900 minor
        Assert.Equal("USD", result.Value.Currency);
        Assert.Equal("sub_123", result.Value.ProviderSubscriptionRef);

        // The checkout id stays the provider reference. Overwriting it with the charge's own id would
        // make every later verification of this payment a 404.
        Assert.Equal(CheckoutId, result.Value.ProviderReference);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal($"/v1/checkout-sessions/{CheckoutId}", request.Uri!.AbsolutePath);

        // Never a speculative filter: Bachs silently drops unknown query parameters, so a hopeful
        // ?reference= would return an unfiltered list with HTTP 200.
        Assert.Equal(string.Empty, request.Uri.Query);
    }

    [Theory]
    [InlineData("expired")]
    [InlineData("cancelled")]
    [InlineData("canceled")]
    [InlineData("failed")]
    [InlineData("underpaid")]
    public async Task A_terminal_non_success_is_reported_as_a_definite_failure(string status)
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, SessionResponse(status, paymentStatus: null, subscriptionId: null));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Succeeded);

        // Final, not merely unpaid. The caller closes the transaction on the strength of this flag, and
        // closing it is the only thing that lets the customer open a new checkout instead of being handed
        // this dead session's URL for ever.
        Assert.True(result.Value.Terminal);
    }

    [Theory]
    [InlineData("completed")]
    [InlineData("succeeded")]
    [InlineData("accepted")]
    public async Task Terminal_success_statuses_verify_successfully(string status)
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, SessionResponse(status: status));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Succeeded);
        Assert.True(result.Value.Terminal);
        Assert.Equal(2900, result.Value.AmountMinor);
    }

    [Fact]
    public async Task A_checkout_with_positive_amount_remaining_is_reported_as_terminal_non_success()
    {
        var body = JsonSerializer.Serialize(new
        {
            checkout_id = CheckoutId,
            status = "completed",
            payment_status = "succeeded",
            amount = "29.00",
            amount_paid = "15.00",
            amount_remaining = "14.00",
            currency = "USD",
            reference = Reference,
        });
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, body);

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Succeeded);
        Assert.True(result.Value.Terminal);
    }

    [Fact]
    public async Task A_checkout_where_amount_and_currency_live_in_charge_still_verifies()
    {
        var body = JsonSerializer.Serialize(new
        {
            checkout_id = CheckoutId,
            status = "succeeded",
            reference = Reference,
            charge = new
            {
                payment_id = "pay_777",
                amount = "29.00",
                currency = "USD",
                subscription_id = "sub_123"
            }
        });
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, body);

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Succeeded);
        Assert.Equal(2900, result.Value.AmountMinor);
        Assert.Equal("USD", result.Value.Currency);
    }

    [Theory]
    // Still awaiting the customer: not a failure, just not an answer yet.
    [InlineData("open")]
    // A status this adapter does not know. Guessing is how a paid order gets written off.
    [InlineData("under_review")]
    [InlineData("")]
    public async Task A_non_terminal_or_unknown_status_is_transient(string status)
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, SessionResponse(status));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    public async Task Verification_never_turns_an_unobtainable_answer_into_a_decline(HttpStatusCode status)
    {
        // Even a 404 or a bad key: the caller treats a non-success as final, so reporting one here on
        // anything other than Bachs' own terminal state would abandon a payment that may have succeeded.
        var handler = StubHttpMessageHandler.Returning(status, """{"detail":"no","error_code":"NOT_FOUND"}""");

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task Verification_without_a_recorded_checkout_id_is_transient_and_makes_no_call()
    {
        // Bachs has no way to resolve our own reference, so we cannot ask — but not knowing the id is not
        // evidence the payment failed.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, SessionResponse());

        var result = await Gateway(handler).VerifyAsync(Verification(providerReference: null), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
        Assert.Empty(handler.Requests);
    }

    [Theory]
    // More precision than USD has. Rounding a provider amount is how a payment gets fulfilled for the
    // wrong figure, so it is refused instead.
    [InlineData("29.999", "USD")]
    [InlineData("not-a-number", "USD")]
    [InlineData(null, "USD")]
    [InlineData("29.00", null)]
    public async Task A_completed_checkout_with_an_unreadable_amount_is_transient(string? amount, string? currency)
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, SessionResponse(amount: amount, currency: currency));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Theory]
    [InlineData("failed")]
    [InlineData("canceled")]
    public async Task A_completed_checkout_contradicted_by_its_payment_status_fulfils_nothing(string paymentStatus)
    {
        // "completed" is documented as "payment succeeded", so this combination is incoherent. Neither
        // fulfil nor declare failure — escalate.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, SessionResponse(paymentStatus: paymentStatus));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task A_session_carrying_a_different_reference_is_refused()
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, SessionResponse(reference: "NF_someone_else"));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Failure, result.Error.Type); // an identity mismatch no retry can fix
    }

    [Fact]
    public async Task A_completed_checkout_with_no_charge_object_still_verifies()
    {
        // The charge is documented as nullable, and a null subscription id is not a reason to withhold a
        // payment Bachs has confirmed.
        var body = JsonSerializer.Serialize(new
        {
            checkout_id = CheckoutId,
            status = "completed",
            payment_status = "succeeded",
            amount = "29.00",
            currency = "USD",
            reference = Reference,
            charge = (object?)null,
        });
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, body);

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Succeeded);
        Assert.Equal(2900, result.Value.AmountMinor);
        Assert.Null(result.Value.ProviderSubscriptionRef);
    }

    [Fact]
    public async Task A_zero_decimal_currency_is_not_scaled()
    {
        // 1000 JPY is ¥1000, not ¥10. Reading it with the wrong exponent undercharges by 100×.
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, SessionResponse(amount: "1000", currency: "JPY"));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1000, result.Value.AmountMinor);
    }

    private static string SessionWithCharge(string sessionAmount, string chargeAmount, string chargeCurrency)
        => JsonSerializer.Serialize(new
        {
            checkout_id = CheckoutId,
            status = "completed",
            payment_status = "succeeded",
            amount = sessionAmount,
            currency = "USD",
            reference = Reference,
            charge = new { payment_id = "pay_777", amount = chargeAmount, currency = chargeCurrency, subscription_id = "sub_123" },
        });

    [Fact]
    public async Task A_charge_that_agrees_with_its_session_verifies()
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, SessionWithCharge("29.00", "29.00", "USD"));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2900, result.Value.AmountMinor);
    }

    [Theory]
    // Bachs' own documented example shows a session total and a charge amount that differ, while warning
    // against assuming they are equal. In the same currency they should agree; when they do not, we do not
    // know which one the customer was charged, and fulfilling on a guess is how a subscription gets granted
    // for the wrong money.
    [InlineData("29.00", "50.00", "USD")]
    [InlineData("50.00", "29.00", "USD")]
    public async Task A_charge_that_contradicts_its_session_is_escalated(
        string sessionAmount, string chargeAmount, string chargeCurrency)
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, SessionWithCharge(sessionAmount, chargeAmount, chargeCurrency));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    /// <summary>
    /// The shape of a real dollar one-off on this account: priced at $79.00 in the session, charged in naira
    /// by FX conversion. The session figures are the base price; the charge figures are what the payer paid.
    /// </summary>
    private static string FxOneOff(
        string status = "completed",
        string? paymentStatus = "succeeded",
        string chargeStatus = "succeeded",
        string? amountRemaining = null) => JsonSerializer.Serialize(new
        {
            checkout_id = CheckoutId,
            mode = "payment",
            status,
            payment_status = paymentStatus,
            amount = "79.00",
            currency = "USD",
            billing_currency = "NGN",
            reference = Reference,
            charge = new
            {
                payment_id = "pay_fx",
                amount = "113421.48",
                currency = "NGN",
                status = chargeStatus,
                amount_remaining = amountRemaining,
                subscription_id = (string?)null,
            },
        });

    [Fact]
    public async Task A_dollar_one_off_charged_in_naira_verifies_at_its_dollar_price()
    {
        // Every FX-converted one-off used to be rejected as "disagrees with its own charge", so no dollar
        // purchase ever fulfilled. The currencies differ because Bachs converted, not because anything is
        // wrong — and what we priced and recorded is the session's $79.00.
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, FxOneOff());

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Succeeded);
        Assert.Equal(7900, result.Value.AmountMinor);
        Assert.Equal("USD", result.Value.Currency);
        Assert.Equal(CheckoutId, result.Value.ProviderReference);
    }

    [Theory]
    [InlineData("succeeded")]
    [InlineData("overpaid")]
    [InlineData("accepted")]
    public async Task An_fx_charge_in_a_settled_state_verifies_without_a_session_payment_status(string chargeStatus)
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, FxOneOff(paymentStatus: null, chargeStatus: chargeStatus));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(7900, result.Value.AmountMinor);
    }

    [Fact]
    public async Task An_fx_charge_with_no_sign_that_money_moved_is_not_fulfilled()
    {
        // The amounts are not comparable across currencies, so a positive payment signal is what stands in
        // for the cross-check. Without one, nothing is fulfilled — and nothing is declared failed either.
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, FxOneOff(paymentStatus: null, chargeStatus: "processing"));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task An_open_session_with_money_still_arriving_stays_payable()
    {
        // A bank transfer under way: the charge is processing and the balance is outstanding. Reporting that
        // as a final failure closed a checkout the customer was in the middle of paying.
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK,
            FxOneOff(status: "open", paymentStatus: "unpaid", chargeStatus: "processing", amountRemaining: "113421.48"));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type); // transient: not Terminal, not a decline
    }

    [Fact]
    public async Task An_open_session_after_a_declined_attempt_stays_payable()
    {
        // A declined card is one attempt, not the end: the session is still open and the customer can try
        // another card or method on the same page.
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK,
            FxOneOff(status: "open", paymentStatus: "failed", chargeStatus: "failed", amountRemaining: "113421.48"));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task A_completed_session_whose_shortfall_was_accepted_is_fulfilled()
    {
        // `accepted` is Bachs saying the merchant took the under- or overpayment as final.
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, FxOneOff(chargeStatus: "accepted", amountRemaining: "1200.00"));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Succeeded);
        Assert.Equal(7900, result.Value.AmountMinor);
    }

    [Fact]
    public async Task A_completed_session_with_an_unaccepted_shortfall_in_the_charge_currency_is_a_final_failure()
    {
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, FxOneOff(chargeStatus: "underpaid", amountRemaining: "1200.00"));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Succeeded);
        Assert.True(result.Value.Terminal);
    }

    [Fact]
    public async Task An_unreadable_charge_amount_does_not_block_a_readable_session_amount()
    {
        // The charge's own amount is optional and secondary; only a charge that positively contradicts
        // the session stops fulfilment. Treating an absent or garbled optional field as a contradiction
        // would strand every payment.
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, SessionWithCharge("29.00", "", "USD"));

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2900, result.Value.AmountMinor);
    }

    [Fact]
    public async Task A_numeric_amount_is_read_rather_than_treated_as_unreadable()
    {
        // Documented as a string, but examples in the same docs show it bare. Either is the same money.
        var body = """
            {"checkout_id":"chk_9f2b","status":"completed","payment_status":"succeeded",
             "amount":29.00,"currency":"USD","reference":"NF_7d4c"}
            """;
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, body);

        var result = await Gateway(handler).VerifyAsync(Verification(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2900, result.Value.AmountMinor);
    }
}
