using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.Gateways;

/// <summary>
/// Paystack adapter — the reference implementation of <see cref="IPaymentGateway"/>. It charges in the
/// plan's own currency and nothing else: which currencies that means is a property of the integration,
/// declared per deployment in <c>Paystack__SupportedCurrencies</c>, and an integration that has not been
/// enabled for a currency refuses it with <c>403 Currency not supported by merchant</c>. Resilience
/// (retry-with-backoff on transient failures + circuit breaker) is attached to this adapter's
/// <see cref="HttpClient"/> in DI, so the methods here stay about mapping, not retrying. This adapter
/// applies NO business effect: it only opens a checkout and reports, authoritatively, what Paystack says
/// about a payment.
/// </summary>
internal sealed class PaystackPaymentGateway : IPaymentGateway
{
    private readonly HttpClient _http;
    private readonly ILogger<PaystackPaymentGateway> _logger;
    private readonly IReadOnlyCollection<string> _currencies;

    public PaystackPaymentGateway(HttpClient http, PaymentProviderOptions options, ILogger<PaystackPaymentGateway> logger)
    {
        _http = http;
        _logger = logger;
        _currencies = options.Currencies;
    }

    public PaymentProvider Provider => PaymentProvider.Paystack;
    public IReadOnlyCollection<string> SupportedCurrencies => _currencies;

    public async Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
    {
        // Paystack takes the amount in the currency's minor unit (kobo/cents) as an integer — exactly
        // how we store it, so no conversion.
        var payload = new
        {
            reference = request.Reference,
            amount = request.AmountMinor,
            currency = request.Currency,
            email = request.CustomerEmail,
            callback_url = request.CallbackUrl,
            metadata = new { idempotency_key = request.IdempotencyKey, recurring = request.Recurring }
        };

        try
        {
            using var response = await _http.PostAsJsonAsync("/transaction/initialize", payload, ct);
            var raw = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Paystack initialize failed: {Status} {Message} (raw: {Raw})",
                    (int)response.StatusCode, ReadString(raw, "message"), raw);

                var detail = $"Paystack returned {(int)response.StatusCode}: {ReadString(raw, "message") ?? raw}";

                // A refusal has to be reported as terminal. Paystack answers 403 "Currency not supported
                // by merchant" when the integration is not enabled for the plan's currency, and that will
                // not come right by being retried: reported as transient it parks the transaction Pending
                // for the reconciliation worker to sweep forever, while the user watches a checkout that
                // never opens. Reported as terminal it marks the row Failed and says why.
                //
                // What must NOT happen here is a retry in some other currency. Converting the amount into
                // whatever the account does accept charges money that neither the transaction row nor the
                // plan recognises, and fulfilment compares the charge against both — so the payment
                // succeeds, the amount gate refuses it, and the customer is left paid-up with no
                // subscription. Failing the checkout is strictly better than taking money we cannot honour.
                return LeavesOutcomeUnknown(response.StatusCode)
                    ? Error.Network("Paystack.Initiate", detail)
                    : Error.Validation("Paystack.Initiate", detail);
            }

            var checkoutUrl = ReadString(raw, "data", "authorization_url");
            var accessCode = ReadString(raw, "data", "access_code");
            if (string.IsNullOrWhiteSpace(checkoutUrl))
                return Error.Network("Paystack.Initiate", "Paystack did not return a checkout URL.");

            return new GatewayInitiation(checkoutUrl, accessCode, raw);
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Paystack.Initiate", $"Could not reach Paystack: {ex.Message}");
        }
    }

    public async Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
    {
        // Paystack resolves our own reference directly, so the provider's id is not needed here.
        var reference = request.Reference;
        try
        {
            using var response = await _http.GetAsync($"/transaction/verify/{Uri.EscapeDataString(reference)}", ct);
            var raw = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Paystack verify failed: {Status}", response.StatusCode);
                return Error.Network("Paystack.Verify", $"Paystack returned {(int)response.StatusCode}.");
            }

            // Paystack marks a settled charge with data.status == "success"; amount is in minor units.
            var status = ReadString(raw, "data", "status");
            var succeeded = string.Equals(status, "success", StringComparison.OrdinalIgnoreCase);
            var totalAmountMinor = ReadLong(raw, "data", "amount") ?? 0;
            var requestedAmountMinor = ReadLong(raw, "data", "requested_amount");
            // If the merchant configured Paystack to pass fees to customer, data.amount is gross (amount + fee)
            // while data.requested_amount is the merchant's net price.
            var amountMinor = (requestedAmountMinor.HasValue && requestedAmountMinor.Value > 0)
                ? requestedAmountMinor.Value
                : totalAmountMinor;
            var currency = ReadString(raw, "data", "currency") ?? string.Empty;
            var providerRef = ReadString(raw, "data", "id") ?? reference;
            var subscriptionRef = ReadString(raw, "data", "authorization", "authorization_code");

            return new GatewayVerification(
                succeeded, amountMinor, currency, providerRef, subscriptionRef, raw,
                Terminal: succeeded || IsFinalFailure(status));
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Paystack.Verify", $"Could not reach Paystack: {ex.Message}");
        }
    }

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
            if (current.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
                return null;
            return current.ValueKind == JsonValueKind.String ? current.GetString() : current.ToString();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static long? ReadLong(string raw, params string[] path)
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

            if (current.ValueKind == JsonValueKind.Number)
            {
                if (current.TryGetInt64(out var num))
                    return num;
                if (current.TryGetDecimal(out var dec))
                    return (long)Math.Round(dec, MidpointRounding.AwayFromZero);
            }

            var str = current.ValueKind == JsonValueKind.String ? current.GetString() : current.ToString();
            if (string.IsNullOrWhiteSpace(str))
                return null;

            if (long.TryParse(str, out var v))
                return v;

            if (decimal.TryParse(str, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var parsedDec))
                return (long)Math.Round(parsedDec, MidpointRounding.AwayFromZero);

            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Paystack statuses that close the door for good. Deliberately short: a Paystack checkout link stays
    /// payable while the transaction sits at <c>abandoned</c>, <c>pending</c>, <c>ongoing</c> or
    /// <c>queued</c>, so calling any of those final would retire a session the customer can still pay —
    /// and the next attempt would open a second charge beside it.
    /// </summary>
    private static bool IsFinalFailure(string? status)
        => string.Equals(status, "failed", StringComparison.OrdinalIgnoreCase)
            || string.Equals(status, "reversed", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Statuses that say nothing about whether the request took effect, and so must stay retryable. Every
    /// other 4xx is Paystack refusing on the merits — a currency the integration cannot take, a duplicate
    /// reference — and repeating it would only produce the same answer.
    /// </summary>
    private static bool LeavesOutcomeUnknown(HttpStatusCode status)
        => (int)status >= 500
            || status == HttpStatusCode.RequestTimeout
            || status == HttpStatusCode.TooManyRequests;
}
