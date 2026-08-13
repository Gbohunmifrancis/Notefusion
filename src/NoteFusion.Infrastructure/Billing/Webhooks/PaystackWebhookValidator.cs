using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.Webhooks;

/// <summary>
/// Verifies Paystack webhooks. Paystack signs the raw request body with HMAC-SHA512 keyed on the
/// secret key and sends it in the <c>x-paystack-signature</c> header. The comparison is constant-time,
/// and it runs on the EXACT received bytes (the API controller must not re-serialize the body first),
/// because any reformatting changes the hash. Only after the signature passes are the routing fields
/// read from the payload.
/// </summary>
internal sealed class PaystackWebhookValidator : IPaymentWebhookValidator
{
    private const string SignatureHeader = "x-paystack-signature";
    private readonly byte[] _secret;

    public PaystackWebhookValidator(PaymentProviderOptions options)
        => _secret = Encoding.UTF8.GetBytes(options.EffectiveWebhookSecret);

    public PaymentProvider Provider => PaymentProvider.Paystack;

    public Result<WebhookMessage> Validate(WebhookRequest request)
    {
        if (!request.Headers.TryGetValue(SignatureHeader, out var signature) || string.IsNullOrWhiteSpace(signature))
            return Error.Unauthorized("Paystack.Webhook", "Missing signature header.");

        var expected = ComputeHmacSha512Hex(request.RawBody);
        var match = CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected),
            Encoding.UTF8.GetBytes(signature.Trim().ToLowerInvariant()));
        if (!match)
            return Error.Unauthorized("Paystack.Webhook", "Signature verification failed.");

        try
        {
            using var doc = JsonDocument.Parse(request.RawBody);
            var root = doc.RootElement;

            var eventType = root.TryGetProperty("event", out var ev) ? ev.GetString() ?? "unknown" : "unknown";
            var reference = root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object
                && data.TryGetProperty("reference", out var r) ? r.GetString() : null;

            // Paystack has no distinct event id; the reference + event type identify the delivery for
            // dedupe (the inbox's unique index is (Provider, ProviderEventId)).
            var eventId = string.IsNullOrWhiteSpace(reference) ? Guid.NewGuid().ToString("N") : $"{eventType}:{reference}";

            return new WebhookMessage(eventId, eventType, reference);
        }
        catch (JsonException)
        {
            return Error.Validation("Paystack.Webhook", "Webhook body was not valid JSON.");
        }
    }

    private string ComputeHmacSha512Hex(string body)
    {
        using var hmac = new HMACSHA512(_secret);
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(body));
        var sb = new StringBuilder(hash.Length * 2);
        foreach (var b in hash)
            sb.Append(b.ToString("x2"));
        return sb.ToString();
    }
}
