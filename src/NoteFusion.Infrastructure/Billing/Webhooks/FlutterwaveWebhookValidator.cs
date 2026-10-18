using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.Webhooks;

/// <summary>
/// Verifies Flutterwave webhooks. Flutterwave signs callbacks with the secret hash configured in the
/// dashboard and passes it in the <c>verif-hash</c> header. The comparison is constant-time. The hash is its
/// own value (<c>Flutterwave__WebhookSecret</c>), never the API secret key: the dashboard sends it in a header
/// on every call, so it must not be a credential that can charge.
/// </summary>
internal sealed class FlutterwaveWebhookValidator : IPaymentWebhookValidator
{
    private const string SignatureHeader = "verif-hash";
    private readonly byte[] _secret;

    // Blank matches nothing: an empty signature is refused below and FixedTimeEquals fails on any other.
    public FlutterwaveWebhookValidator(PaymentProviderOptions options)
        => _secret = Encoding.UTF8.GetBytes(options.WebhookSecret?.Trim() ?? string.Empty);

    public PaymentProvider Provider => PaymentProvider.Flutterwave;

    public Result<WebhookMessage> Validate(WebhookRequest request)
    {
        if (!request.Headers.TryGetValue(SignatureHeader, out var signature) || string.IsNullOrWhiteSpace(signature))
            return Error.Unauthorized("Flutterwave.Webhook", "Missing verif-hash signature header.");

        var match = CryptographicOperations.FixedTimeEquals(
            _secret,
            Encoding.UTF8.GetBytes(signature.Trim()));

        if (!match)
            return Error.Unauthorized("Flutterwave.Webhook", "Signature verification failed.");

        try
        {
            using var doc = JsonDocument.Parse(request.RawBody);
            var root = doc.RootElement;

            var eventType = root.TryGetProperty("event", out var ev)
                ? ev.GetString() ?? "charge.completed"
                : root.TryGetProperty("event.type", out var evt)
                    ? evt.GetString() ?? "charge.completed"
                    : "charge.completed";

            string? reference = null;
            string? id = null;
            string? status = null;

            if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object)
            {
                if (data.TryGetProperty("tx_ref", out var txRef))
                    reference = txRef.GetString();
                else if (data.TryGetProperty("txRef", out var txR))
                    reference = txR.GetString();

                if (data.TryGetProperty("id", out var idProp))
                {
                    id = idProp.ValueKind == JsonValueKind.Number
                        ? idProp.GetInt64().ToString()
                        : idProp.GetString();
                }

                if (data.TryGetProperty("status", out var st) && st.ValueKind == JsonValueKind.String)
                    status = st.GetString();
            }

            // The status is part of the id: a transaction reported failed and then, retried on the same page,
            // successful is two events, and the second must not be dropped as a duplicate of the first.
            var eventId = !string.IsNullOrWhiteSpace(id)
                ? string.IsNullOrWhiteSpace(status) ? $"flw:{id}" : $"flw:{id}:{status.ToLowerInvariant()}"
                : !string.IsNullOrWhiteSpace(reference)
                    ? $"flw:{eventType}:{reference}"
                    : Guid.NewGuid().ToString("N");

            return new WebhookMessage(eventId, eventType, reference);
        }
        catch (JsonException)
        {
            return Error.Validation("Flutterwave.Webhook", "Webhook body was not valid JSON.");
        }
    }
}
