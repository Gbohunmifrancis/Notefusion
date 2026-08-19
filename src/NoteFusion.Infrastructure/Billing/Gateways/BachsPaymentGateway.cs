using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.Gateways;

/// <summary>
/// Bachs adapter. Opens a hosted checkout and reports, authoritatively, what Bachs says about it —
/// nothing more: no ledger write, no entitlement, no retry loop (resilience is attached to this
/// adapter's <see cref="HttpClient"/> in DI).
/// </summary>
/// <remarks>
/// Three properties of the Bachs API shape this adapter and are worth stating, because each one has a
/// tempting wrong implementation:
/// <list type="number">
/// <item><description>
/// <b>Recurrence is a property of the product, not of the request.</b> There is no recurring flag and no
/// create-subscription endpoint: a checkout becomes a subscription because a catalog product in the cart
/// has a <c>billing_cycle</c>, and a subscription checkout needs exactly one such product (a raw amount is
/// rejected in a cart). So a recurring plan code has to resolve to a <c>prod_…</c> id via
/// <see cref="BachsOptions.ProductMap"/>, and the price we charge lives in Bachs' catalog, not in our
/// request body. That coupling is checked where it can be checked safely — at verification, against the
/// amount we recorded — so a catalog price that drifts from our plan price blocks fulfilment instead of
/// silently granting a subscription for the wrong money. A ONE-OFF is the other branch of the same fact:
/// it sends <c>pricing</c> instead of a cart, needs no catalog product, and Bachs settles it as
/// <c>mode: "payment"</c>. The two pricing sources are mutually exclusive, and which one we send is the
/// only thing that decides the mode.
/// </description></item>
/// <item><description>
/// <b>Bachs cannot be asked about a payment by our own reference.</b> No endpoint accepts one: the
/// checkout GET takes only Bachs' <c>chk_</c> id, and the payments list filters on nothing but
/// limit/offset/status. Worse, Bachs documents that unknown query parameters are silently dropped, so a
/// hopeful <c>?reference=…</c> returns an unfiltered first page with HTTP 200 — an adapter that trusted
/// it would attribute a stranger's payment to our order. Verification therefore goes strictly through
/// the <c>checkout_id</c> learned at initiation, and the echoed reference is re-asserted on the way back.
/// That is also why initiation fails when Bachs returns a checkout URL without an id: sending a user to
/// a checkout we could never verify would be taking money we can never honour.
/// </description></item>
/// <item><description>
/// <b>Money is a decimal string in major units</b> (<c>"29.00"</c>), always beside its currency. It
/// crosses into our integral minor units only through <see cref="CurrencyUnits"/>, and an amount we
/// cannot read exactly is treated as "provider unreachable", never as zero and never as a mismatch.
/// </description></item>
/// </list>
/// A failure here is classified rather than just reported, because the caller acts on the distinction:
/// anything that leaves the outcome unknown (timeout, 5xx, 429, idempotency conflict) comes back as
/// <see cref="ErrorType.Network"/> so the transaction stays reclaimable by the same idempotency key,
/// while a definite refusal (validation, auth, unknown product) is terminal. Verification never invents
/// a decline: only Bachs' own terminal non-success states produce <c>Succeeded: false</c>.
/// </remarks>
internal sealed class BachsPaymentGateway : IPaymentGateway
{
    private const string CheckoutSessionsPath = "/v1/checkout-sessions";
    private const string IdempotencyHeader = "Idempotency-Key";

    /// <summary>
    /// Omits null properties so one payload shape can carry optional fields. Bachs fingerprints
    /// idempotent requests on the exact body, so the serialized bytes must be stable across retries —
    /// hence a single options instance and a payload whose property order is fixed by its declaration.
    /// </summary>
    private static readonly JsonSerializerOptions PayloadJson = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;
    private readonly BachsOptions _options;
    private readonly ILogger<BachsPaymentGateway> _logger;

    public BachsPaymentGateway(HttpClient http, BachsOptions options, ILogger<BachsPaymentGateway> logger)
    {
        _http = http;
        _options = options;
        _logger = logger;
    }

    public PaymentProvider Provider => PaymentProvider.Bachs;
    public IReadOnlyCollection<string> SupportedCurrencies => _options.Currencies;

    public async Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
    {
        // Only a recurring session needs a catalog product — the cart is what makes it recurring. A
        // one-off carries its own amount, so demanding a mapping for one would refuse a charge Bachs
        // would have taken happily.
        string? productId = null;
        if (request.Recurring)
        {
            productId = _options.ProductIdFor(request.PlanCode);
            if (productId is null)
            {
                // Terminal on purpose: Bachs is never contacted, so no money can have moved, and retrying
                // cannot help until someone maps this plan. Failing loudly beats opening a one-off charge
                // that would never become a subscription.
                return Error.Validation(
                    "Bachs.Initiate", $"No Bachs product is mapped for plan '{request.PlanCode}'.");
            }
        }

        // The pricing source IS the session mode, and Bachs never says so out loud: a cart of catalog
        // products yields `mode: "subscription"`, a raw `pricing` amount yields `mode: "payment"`. The two
        // are mutually exclusive — a body carrying both is refused with "Provide exactly one pricing
        // source" — so exactly one of these is non-null, and `WhenWritingNull` drops the other.
        object? productCart = productId is null
            ? null
            : new[] { new { product_id = productId, quantity = 1 } };

        object? pricing = productId is not null
            ? null
            : new
            {
                amount = CurrencyUnits.ToMajorString(request.AmountMinor, request.Currency),
                currency = request.Currency,
            };

        var payload = new
        {
            // `name` is required by the reference schema. Real users can still have a blank profile
            // name, and a 400 there would block the upgrade entirely, so fall back to the email's local
            // part rather than send nothing.
            customer = new
            {
                email = request.CustomerEmail,
                name = FallbackName(request.CustomerName, request.CustomerEmail),
            },

            // Exactly one pricing source, chosen above. A cart makes the session recurring; a `pricing`
            // amount makes it a single charge.
            product_cart = productCart,
            pricing = pricing,
            reference = request.Reference,
            success_url = request.CallbackUrl,

            // Pins a catalog product to the currency we priced and recorded, so a multi-currency product
            // cannot settle in one we did not expect. A one-off states its currency inside `pricing`, and
            // sending both there is redundant at best, so it is omitted.
            billing_currency = request.Recurring ? request.Currency : null,

            // Bachs documents a 400 (SUBSCRIPTION_METHOD_NOT_SUPPORTED) for a subscription paid by
            // anything but card, so a recurring session offers only card. Null is omitted entirely.
            allowed_payment_method_types = request.Recurring ? new[] { "card" } : null,
            expires_in_minutes = _options.CheckoutExpiryMinutes,
            metadata = new { plan_code = request.PlanCode, reference = request.Reference },
        };

        // Serialized once and sent as bytes: Bachs' idempotency fingerprint covers method, path AND
        // body, so a retry that re-serializes into different whitespace or key order would be rejected
        // as a conflict instead of replaying the original session.
        var body = JsonSerializer.Serialize(payload, PayloadJson);

        try
        {
            using var message = new HttpRequestMessage(HttpMethod.Post, CheckoutSessionsPath)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };

            // Per-request, not a client default: the key identifies THIS initiation attempt. Our caller
            // keeps it stable across retries of the same pending transaction, which is what makes Bachs
            // return the original checkout instead of opening a second one.
            message.Headers.TryAddWithoutValidation(IdempotencyHeader, request.IdempotencyKey);

            using var response = await _http.SendAsync(message, ct);
            var raw = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Bachs checkout-session create failed: {Status} {Detail}",
                    (int)response.StatusCode, Describe(raw));

                return LeavesOutcomeUnknown(response.StatusCode)
                    ? Error.Network("Bachs.Initiate", $"Bachs returned {(int)response.StatusCode}: {Describe(raw)}")
                    : Error.Validation("Bachs.Initiate", $"Bachs returned {(int)response.StatusCode}: {Describe(raw)}");
            }

            // Three different 201 shapes are documented for this one endpoint, so only the three fields
            // all of them agree on are read, and none of them is assumed present.
            var checkoutUrl = ReadString(raw, "checkout_url");
            var checkoutId = ReadString(raw, "checkout_id");

            if (string.IsNullOrWhiteSpace(checkoutUrl) || string.IsNullOrWhiteSpace(checkoutId))
            {
                // Transient, not terminal: a session may well be open on Bachs' side, and the row must
                // stay reclaimable by the same idempotency key — which is the only thing that can hand
                // us the id we just failed to read.
                return Error.Network(
                    "Bachs.Initiate", "Bachs did not return both a checkout URL and a checkout id.");
            }

            // The reference is what every later webhook correlates on. If Bachs echoed a different one,
            // we are looking at someone else's session and must not hand its URL to this user.
            var echoed = ReadString(raw, "reference");
            if (!string.IsNullOrEmpty(echoed) && !string.Equals(echoed, request.Reference, StringComparison.Ordinal))
            {
                _logger.LogError(
                    "Bachs echoed reference {Echoed} for checkout {CheckoutId}, expected {Expected}.",
                    echoed, checkoutId, request.Reference);
                return Error.Failure("Bachs.Initiate", "Bachs echoed a different reference for this checkout.");
            }

            return new GatewayInitiation(checkoutUrl, checkoutId, raw);
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Bachs.Initiate", $"Could not reach Bachs: {ex.Message}");
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            // A client-side timeout is the canonical "we do not know what happened" case: the session
            // may exist and the user may already be looking at it.
            return Error.Network("Bachs.Initiate", $"Bachs did not respond in time: {ex.Message}");
        }
    }

    public async Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
    {
        // Not knowing Bachs' id is not evidence that the payment failed — and Bachs has no other way to
        // look it up — so this is transient. Declaring failure here would strand a paid customer.
        if (string.IsNullOrWhiteSpace(request.ProviderReference))
            return Error.Network("Bachs.Verify", "No Bachs checkout id is recorded for this payment yet.");

        var checkoutId = request.ProviderReference;

        try
        {
            using var response = await _http.GetAsync(
                $"{CheckoutSessionsPath}/{Uri.EscapeDataString(checkoutId)}", ct);
            var raw = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                // Every non-2xx is transient here, including 404 and 401. Verification exists to find out
                // whether money moved; an answer we could not obtain must never be reported as "it
                // didn't", because the caller treats a non-success as final and stops asking.
                _logger.LogWarning(
                    "Bachs checkout {CheckoutId} verify failed: {Status} {Detail}",
                    checkoutId, (int)response.StatusCode, Describe(raw));
                return Error.Network("Bachs.Verify", $"Bachs returned {(int)response.StatusCode} for {checkoutId}.");
            }

            // Belt to the braces of looking up by Bachs' own id: if the session we were handed carries a
            // different reference, something is mismatched at the identity level and no amount of
            // retrying will fix it. Absent (null) is documented and fine — the id already binds it.
            var echoed = ReadString(raw, "reference");
            if (!string.IsNullOrEmpty(echoed) && !string.Equals(echoed, request.Reference, StringComparison.Ordinal))
            {
                _logger.LogError(
                    "Bachs checkout {CheckoutId} carries reference {Echoed}, expected {Expected}.",
                    checkoutId, echoed, request.Reference);
                return Error.Failure("Bachs.Verify", "Bachs returned a checkout for a different reference.");
            }

            var status = ReadString(raw, "status");
            var paymentStatus = ReadString(raw, "payment_status");
            var currency = ReadString(raw, "currency");
            var amountMinor = CurrencyUnits.TryToMinor(ReadString(raw, "amount"), currency ?? string.Empty);

            // A closed, documented enum, unlike the open-ended status set on the webhook payload — which
            // is exactly why fulfilment re-verifies here instead of trusting the event's own verdict.
            if (IsTerminalNonSuccess(status))
            {
                // Final: an expired or cancelled session cannot be paid, now or later. Saying so lets the
                // caller close the transaction, which is what frees the user to start a fresh checkout.
                return new GatewayVerification(
                    Succeeded: false, amountMinor ?? 0, currency ?? string.Empty, checkoutId, null, raw,
                    Terminal: true);
            }

            if (!string.Equals(status, "completed", StringComparison.OrdinalIgnoreCase))
            {
                // `open` (still awaiting the customer) or a status this adapter does not know. Neither is
                // evidence of anything, so the caller keeps asking rather than concluding.
                return Error.Network(
                    "Bachs.Verify", $"Bachs checkout {checkoutId} is not in a terminal state (status: {status ?? "unknown"}).");
            }

            // `completed` is documented as "payment succeeded", so a failed/canceled payment_status
            // alongside it is a contradiction. Refuse to fulfil, and refuse to declare failure either.
            if (IsFailedPaymentStatus(paymentStatus))
            {
                _logger.LogError(
                    "Bachs checkout {CheckoutId} is completed but payment_status is {PaymentStatus}.",
                    checkoutId, paymentStatus);
                return Error.Network(
                    "Bachs.Verify", $"Bachs checkout {checkoutId} reports completed with payment_status {paymentStatus}.");
            }

            if (amountMinor is null || string.IsNullOrWhiteSpace(currency))
            {
                // We will not fulfil against an amount we cannot read exactly. Transient, so it is
                // retried and then escalated, rather than being rounded into a wrong entitlement.
                return Error.Network(
                    "Bachs.Verify", $"Bachs checkout {checkoutId} did not report a readable amount and currency.");
            }

            // The session total and the charge are two different numbers in Bachs' own example, and the
            // docs warn against assuming they are equal. When both are readable and they disagree we do
            // not know which figure the customer was actually charged — so neither is used. Escalating
            // beats fulfilling against the wrong money, and beats declining a payment that may be good.
            var chargeCurrency = ReadString(raw, "charge", "currency");
            var chargeAmountMinor = CurrencyUnits.TryToMinor(
                ReadString(raw, "charge", "amount"), chargeCurrency ?? currency);

            if (chargeAmountMinor is not null && chargeAmountMinor != amountMinor.Value)
            {
                _logger.LogError(
                    "Bachs checkout {CheckoutId} reports session amount {SessionAmount} but charge amount {ChargeAmount}.",
                    checkoutId, amountMinor.Value, chargeAmountMinor.Value);
                return Error.Network(
                    "Bachs.Verify",
                    $"Bachs checkout {checkoutId} disagrees with its own charge about the amount.");
            }

            if (!string.IsNullOrWhiteSpace(chargeCurrency)
                && !string.Equals(chargeCurrency, currency, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogError(
                    "Bachs checkout {CheckoutId} is in {SessionCurrency} but its charge is in {ChargeCurrency}.",
                    checkoutId, currency, chargeCurrency);
                return Error.Network(
                    "Bachs.Verify",
                    $"Bachs checkout {checkoutId} disagrees with its own charge about the currency.");
            }

            // The checkout id stays the provider reference even though the charge has an id of its own:
            // it is the ONLY key that can verify this payment again, so overwriting it with a charge or
            // payment id would make every later lookup a 404.
            var subscriptionRef = ReadString(raw, "charge", "subscription_id");

            return new GatewayVerification(
                Succeeded: true, amountMinor.Value, currency, checkoutId, subscriptionRef, raw, Terminal: true);
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Bachs.Verify", $"Could not reach Bachs: {ex.Message}");
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            return Error.Network("Bachs.Verify", $"Bachs did not respond in time: {ex.Message}");
        }
    }

    /// <summary>
    /// True when the status code leaves it unknown whether Bachs acted. 429 and 5xx are the plain
    /// transient cases; 409 is included because it means our idempotency key was reused with a different
    /// body — the original session may be alive and paid, and burning the transaction would retire the
    /// only key that can still reach it.
    /// </summary>
    private static bool LeavesOutcomeUnknown(HttpStatusCode status)
        => (int)status >= 500
            || status == HttpStatusCode.RequestTimeout
            || status == HttpStatusCode.TooManyRequests
            || status == HttpStatusCode.Conflict;

    /// <summary>Bachs' terminal non-success checkout states. Note the British <c>cancelled</c>.</summary>
    private static bool IsTerminalNonSuccess(string? status)
        => string.Equals(status, "expired", StringComparison.OrdinalIgnoreCase)
            || string.Equals(status, "cancelled", StringComparison.OrdinalIgnoreCase)
            || string.Equals(status, "canceled", StringComparison.OrdinalIgnoreCase);

    private static bool IsFailedPaymentStatus(string? paymentStatus)
        => string.Equals(paymentStatus, "failed", StringComparison.OrdinalIgnoreCase)
            || string.Equals(paymentStatus, "canceled", StringComparison.OrdinalIgnoreCase)
            || string.Equals(paymentStatus, "cancelled", StringComparison.OrdinalIgnoreCase);

    private static string FallbackName(string? name, string email)
    {
        if (!string.IsNullOrWhiteSpace(name))
            return name.Trim();

        var at = email.IndexOf('@', StringComparison.Ordinal);
        return at > 0 ? email[..at] : email;
    }

    /// <summary>
    /// Renders a Bachs error envelope for logs and messages. The documented pages disagree on its shape,
    /// so <c>detail</c>/<c>error_code</c> are read if present and the body is used verbatim otherwise.
    /// </summary>
    private static string Describe(string raw)
    {
        var code = ReadString(raw, "error_code");
        var detail = ReadString(raw, "detail");

        if (code is null && detail is null)
            return string.IsNullOrWhiteSpace(raw) ? "(no body)" : Truncate(raw);

        return string.Join(' ', new[] { code, detail }.Where(p => !string.IsNullOrWhiteSpace(p)));
    }

    private static string Truncate(string value)
        => value.Length <= 500 ? value : string.Concat(value.AsSpan(0, 500), "…");

    private static string? ReadString(string raw, params string[] path)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var current = doc.RootElement;
            foreach (var segment in path)
            {
                if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out var next))
                    return null;
                current = next;
            }

            return current.ValueKind switch
            {
                JsonValueKind.String => current.GetString(),
                // Amounts are documented as strings but appear bare in places; read a number rather than
                // treating a readable amount as unreadable.
                JsonValueKind.Number => current.GetRawText(),
                _ => null,
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
