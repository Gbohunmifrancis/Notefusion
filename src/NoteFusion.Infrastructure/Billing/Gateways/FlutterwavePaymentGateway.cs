using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.Gateways;

/// <summary>
/// Flutterwave adapter for <see cref="IPaymentGateway"/>. Initiates hosted checkouts via Flutterwave Standard
/// (/v3/payments) and verifies transaction status via Flutterwave Verification API (/v3/transactions).
/// Follows Clean Architecture and typed HttpClient resilience.
/// </summary>
internal sealed class FlutterwavePaymentGateway : IPaymentGateway
{
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
        // Flutterwave takes amount in major units (e.g. 50.00) as decimal/string
        var majorAmount = (request.AmountMinor / 100m).ToString("0.00", CultureInfo.InvariantCulture);

        var payload = new
        {
            tx_ref = request.Reference,
            amount = majorAmount,
            currency = request.Currency,
            redirect_url = request.CallbackUrl,
            customer = new
            {
                email = request.CustomerEmail,
                name = request.CustomerName ?? request.CustomerEmail
            },
            customizations = new
            {
                title = "NoteFusion Pro"
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

            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                // A 404 from Flutterwave means the checkout session was never initiated/completed at the provider
                return new GatewayVerification(
                    Succeeded: false,
                    AmountMinor: 0,
                    Currency: "USD",
                    ProviderReference: request.ProviderReference ?? string.Empty,
                    ProviderSubscriptionRef: null,
                    Raw: raw,
                    Terminal: false);
            }

            if (!response.IsSuccessStatusCode)
            {
                var msg = ReadString(raw, "message") ?? $"HTTP {(int)response.StatusCode}";
                return Error.Network("Flutterwave.Verify", $"Flutterwave verify failed: {msg}");
            }

            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
            {
                return Error.Network("Flutterwave.Verify", "Flutterwave response contained no data payload.");
            }

            var status = data.TryGetProperty("status", out var st) ? st.GetString() : null;
            var providerId = data.TryGetProperty("id", out var idProp)
                ? (idProp.ValueKind == JsonValueKind.Number ? idProp.GetInt64().ToString() : idProp.GetString())
                : request.ProviderReference;

            var currency = data.TryGetProperty("currency", out var currProp) ? currProp.GetString() ?? "USD" : "USD";
            var amountMajor = data.TryGetProperty("amount", out var amtProp)
                ? (amtProp.ValueKind == JsonValueKind.Number ? amtProp.GetDecimal() : 0m)
                : 0m;

            var amountMinor = (long)Math.Round(amountMajor * 100m, MidpointRounding.AwayFromZero);

            var succeeded = string.Equals(status, "successful", StringComparison.OrdinalIgnoreCase);
            var terminal = string.Equals(status, "failed", StringComparison.OrdinalIgnoreCase)
                || string.Equals(status, "cancelled", StringComparison.OrdinalIgnoreCase);

            return new GatewayVerification(
                Succeeded: succeeded,
                AmountMinor: amountMinor,
                Currency: currency.ToUpperInvariant(),
                ProviderReference: providerId ?? request.Reference,
                ProviderSubscriptionRef: null,
                Raw: raw,
                Terminal: terminal);
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Flutterwave.Verify", $"Could not reach Flutterwave: {ex.Message}");
        }
        catch (JsonException ex)
        {
            return Error.Network("Flutterwave.Verify", $"Invalid JSON from Flutterwave: {ex.Message}");
        }
    }

    private static bool LeavesOutcomeUnknown(HttpStatusCode code)
        => (int)code >= 500 || code is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests;

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
