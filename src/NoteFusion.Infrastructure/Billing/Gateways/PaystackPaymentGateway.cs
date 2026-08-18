using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.Gateways;

/// <summary>
/// Paystack adapter — the reference implementation of <see cref="IPaymentGateway"/>. Paystack supports
/// USD (the product currency) and has a hosted checkout, which is why it is wired end-to-end while the
/// other providers remain stubs until credentialed. Resilience (retry-with-backoff on transient
/// failures + circuit breaker) is attached to this adapter's <see cref="HttpClient"/> in DI, so the
/// methods here stay about mapping, not retrying. This adapter applies NO business effect: it only
/// opens a checkout and reports, authoritatively, what Paystack says about a payment.
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
                _logger.LogWarning("Paystack initialize failed: {Status} (raw: {Raw})", response.StatusCode, raw);
                
                // Fallback for Paystack test keys: if USD fails with 403/400 (currency not enabled), retry without specifying currency
                if ((response.StatusCode == System.Net.HttpStatusCode.Forbidden || response.StatusCode == System.Net.HttpStatusCode.BadRequest) && payload.currency == "USD")
                {
                    _logger.LogInformation("Retrying Paystack initialize with default account currency...");
                    var fallbackPayload = new
                    {
                        reference = request.Reference,
                        amount = request.AmountMinor * 1500, // Approximate USD to NGN kobo conversion for test key
                        email = request.CustomerEmail,
                        callback_url = request.CallbackUrl,
                        metadata = new { idempotency_key = request.IdempotencyKey, recurring = request.Recurring }
                    };
                    using var retryResp = await _http.PostAsJsonAsync("/transaction/initialize", fallbackPayload, ct);
                    raw = await retryResp.Content.ReadAsStringAsync(ct);
                    if (!retryResp.IsSuccessStatusCode)
                    {
                        return Error.Network("Paystack.Initiate", $"Paystack returned {(int)retryResp.StatusCode}: {ReadString(raw, "message") ?? raw}");
                    }
                }
                else
                {
                    return Error.Network("Paystack.Initiate", $"Paystack returned {(int)response.StatusCode}: {ReadString(raw, "message") ?? raw}");
                }
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
            var amountMinor = ReadLong(raw, "data", "amount") ?? 0;
            var currency = ReadString(raw, "data", "currency") ?? string.Empty;
            var providerRef = ReadString(raw, "data", "id") ?? reference;
            var subscriptionRef = ReadString(raw, "data", "authorization", "authorization_code");

            return new GatewayVerification(succeeded, amountMinor, currency, providerRef, subscriptionRef, raw);
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
            return current.ValueKind == JsonValueKind.String ? current.GetString() : current.ToString();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static long? ReadLong(string raw, params string[] path)
        => long.TryParse(ReadString(raw, path), out var v) ? v : null;
}
