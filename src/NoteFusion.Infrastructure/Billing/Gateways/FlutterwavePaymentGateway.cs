using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.Gateways;

/// <summary>
/// Flutterwave adapter for <see cref="IPaymentGateway"/>. Initiates hosted checkouts via Flutterwave Standard
/// (/v3/payments) and verifies transaction status via Flutterwave Verification API (/v3/transactions).
/// Follows Clean Architecture and typed HttpClient resilience.
/// </summary>
internal sealed class FlutterwavePaymentGateway : IPaymentGateway
{
    /// <summary>
    /// How long the hosted page takes money, in minutes: Flutterwave's maximum, a day. The stale sweep closes a
    /// checkout nobody paid a day after it opened (<c>BillingSettings.StaleProcessingHours</c>), so the page must
    /// not outlive it; without it Flutterwave sets no limit of its own.
    /// </summary>
    private const int SessionMinutes = 1440;

    private readonly HttpClient _http;
    private readonly ILogger<FlutterwavePaymentGateway> _logger;
    private readonly IReadOnlyCollection<string> _currencies;

    public FlutterwavePaymentGateway(
        HttpClient http,
        PaymentProviderOptions options,
        ILogger<FlutterwavePaymentGateway> logger)
    {
        _http = http;
        _logger = logger;
        _currencies = options.Currencies;
    }

    public PaymentProvider Provider => PaymentProvider.Flutterwave;
    public IReadOnlyCollection<string> SupportedCurrencies => _currencies;

    public async Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
    {
        var payload = new
        {
            tx_ref = request.Reference,
            // Major units on the wire, with the currency's own decimals ("4.99" USD, "1000" UGX).
            amount = CurrencyUnits.ToMajorString(request.AmountMinor, request.Currency),
            currency = request.Currency,
            redirect_url = request.CallbackUrl,
            customer = new
            {
                email = request.CustomerEmail,
                name = string.IsNullOrWhiteSpace(request.CustomerName) ? request.CustomerEmail : request.CustomerName
            },
            customizations = new
            {
                title = "NoteFusion"
            },
            configurations = new
            {
                session_duration = SessionMinutes
            },
            meta = new
            {
                idempotency_key = request.IdempotencyKey,
                recurring = request.Recurring,
                plan_code = request.PlanCode
            }
        };

        try
        {
            using var response = await _http.PostAsJsonAsync("/v3/payments", payload, ct);
            var raw = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Flutterwave initiate failed: {Status} {Message} (raw: {Raw})",
                    (int)response.StatusCode, ReadString(raw, "message"), raw);

                var detail = $"Flutterwave returned {(int)response.StatusCode}: {ReadString(raw, "message") ?? raw}";

                return LeavesOutcomeUnknown(response.StatusCode)
                    ? Error.Network("Flutterwave.Initiate", detail)
                    : Error.Validation("Flutterwave.Initiate", detail);
            }

            var checkoutUrl = ReadString(raw, "data", "link");
            if (string.IsNullOrWhiteSpace(checkoutUrl))
                return Error.Network("Flutterwave.Initiate", "Flutterwave did not return a hosted payment link.");

            return new GatewayInitiation(checkoutUrl, null, raw);
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Flutterwave.Initiate", $"Could not reach Flutterwave: {ex.Message}");
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            return OutboundFailure.ToError(ex, "Flutterwave.Initiate", "Flutterwave");
        }
    }

    public async Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
    {
        // Prefer verification by provider transaction ID if present; fallback to tx_ref
        var path = !string.IsNullOrWhiteSpace(request.ProviderReference) && long.TryParse(request.ProviderReference, out _)
            ? $"/v3/transactions/{Uri.EscapeDataString(request.ProviderReference)}/verify"
            : $"/v3/transactions/verify_by_reference?tx_ref={Uri.EscapeDataString(request.Reference)}";

        try
        {
            using var response = await _http.GetAsync(path, ct);
            var raw = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                // A page opened and never paid has no transaction, and Flutterwave says so with an error
                // ("No transaction was found for this id"). That is its answer, not a failure to get one: not
                // paid, and not final, since the page still takes money. Read as a network error it would leave
                // the row Processing for good, because the stale sweep closes only what the provider answered for.
                if (IsNoTransaction(response.StatusCode, raw))
                {
                    return new GatewayVerification(
                        Succeeded: false,
                        AmountMinor: 0,
                        Currency: string.Empty,
                        ProviderReference: request.ProviderReference ?? request.Reference,
                        ProviderSubscriptionRef: null,
                        Raw: raw,
                        Terminal: false);
                }

                var msg = ReadString(raw, "message") ?? $"HTTP {(int)response.StatusCode}";
                _logger.LogWarning(
                    "Flutterwave verify of {Reference} failed: {Status} {Message}",
                    request.Reference, (int)response.StatusCode, msg);
                return Error.Network("Flutterwave.Verify", $"Flutterwave verify failed: {msg}");
            }

            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
            {
                return Error.Network("Flutterwave.Verify", "Flutterwave response contained no data payload.");
            }

            // Looked up by Flutterwave's own id, the transaction must still be this checkout's: one carrying
            // another reference is someone else's payment, and no retry will make it ours.
            var echoed = ReadElementString(data, "tx_ref");
            if (!string.IsNullOrEmpty(echoed) && !string.Equals(echoed, request.Reference, StringComparison.Ordinal))
            {
                _logger.LogError(
                    "Flutterwave transaction {Id} carries tx_ref {Echoed}, expected {Expected}.",
                    request.ProviderReference, echoed, request.Reference);
                return Error.Failure("Flutterwave.Verify", "Flutterwave returned a transaction for a different reference.");
            }

            var status = ReadElementString(data, "status");
            var providerId = ReadElementString(data, "id") ?? request.ProviderReference;
            var currency = ReadElementString(data, "currency")?.ToUpperInvariant() ?? string.Empty;
            var amountMinor = currency.Length == 0 ? null : CurrencyUnits.TryToMinor(ReadElementString(data, "amount"), currency);

            // Only "successful" is paid. Nothing else is final: Flutterwave keeps the page open after a declined
            // card for the customer to try again, until the session ends, so a "failed" transaction may yet be paid.
            // The stale sweep closes what is still unpaid when the session has gone.
            var succeeded = string.Equals(status, "successful", StringComparison.OrdinalIgnoreCase);
            if (succeeded && amountMinor is null)
            {
                // We will not fulfil against an amount we cannot read exactly. Transient, so it is retried and
                // then escalated, rather than being rounded into a wrong entitlement.
                return Error.Network(
                    "Flutterwave.Verify", $"Flutterwave transaction {providerId} did not report a readable amount and currency.");
            }

            return new GatewayVerification(
                Succeeded: succeeded,
                AmountMinor: amountMinor ?? 0,
                Currency: currency,
                ProviderReference: providerId ?? request.Reference,
                ProviderSubscriptionRef: null,
                Raw: raw,
                Terminal: succeeded);
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Flutterwave.Verify", $"Could not reach Flutterwave: {ex.Message}");
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            return OutboundFailure.ToError(ex, "Flutterwave.Verify", "Flutterwave");
        }
        catch (JsonException ex)
        {
            return Error.Network("Flutterwave.Verify", $"Invalid JSON from Flutterwave: {ex.Message}");
        }
    }

    /// <summary>The verification, and from the same transaction what the page has seen of the customer.</summary>
    public async Task<GatewayCheck> CheckAsync(GatewayVerificationRequest request, CancellationToken ct)
    {
        var verification = await VerifyAsync(request, ct);
        return new GatewayCheck(
            verification, verification.IsSuccess && verification.Value.Raw is { } raw ? ReadAttempt(raw) : null);
    }

    /// <summary>
    /// What a Flutterwave transaction shows of the customer: <c>failed</c> is a declined attempt; one still
    /// <c>pending</c> on a bank transfer, account or USSD payment is money on its way; anything else, no
    /// transaction at all included, is no attempt.
    /// </summary>
    internal static CheckoutAttempt ReadAttempt(string raw)
    {
        var status = ReadString(raw, "data", "status");
        var paymentType = ReadString(raw, "data", "payment_type");
        static bool Is(string? value, params string[] any)
            => value is not null && any.Any(a => string.Equals(value, a, StringComparison.OrdinalIgnoreCase));

        if (Is(status, "pending") && Is(paymentType, "bank_transfer", "banktransfer", "account", "ussd"))
            return CheckoutAttempt.TransferStarted;
        if (Is(status, "failed"))
            return CheckoutAttempt.Declined;
        return CheckoutAttempt.None;
    }

    /// <summary>
    /// Flutterwave's "there is no transaction under this reference", which it answers with a 400 or 404 and a
    /// message saying so. Any other refusal (a bad key, a malformed request, a bare 404 from a wrong base URL)
    /// tells us nothing about the payment.
    /// </summary>
    private static bool IsNoTransaction(HttpStatusCode code, string raw)
    {
        if (code is not (HttpStatusCode.BadRequest or HttpStatusCode.NotFound))
            return false;
        var message = ReadString(raw, "message");
        return message is not null
            && (message.Contains("no transaction", StringComparison.OrdinalIgnoreCase)
                || message.Contains("transaction not found", StringComparison.OrdinalIgnoreCase));
    }

    private static bool LeavesOutcomeUnknown(HttpStatusCode code)
        => (int)code >= 500 || code is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests;

    /// <summary>A string or number property as text (Flutterwave sends ids and amounts as JSON numbers).</summary>
    private static string? ReadElementString(JsonElement element, string name)
        => element.TryGetProperty(name, out var value)
            ? value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.GetRawText(),
                _ => null
            }
            : null;

    private static string? ReadString(string json, params string[] path)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var current = doc.RootElement;
            foreach (var segment in path)
            {
                if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                    return null;
            }
            return current.ValueKind == JsonValueKind.String ? current.GetString() : current.ToString();
        }
        catch
        {
            return null;
        }
    }
}
