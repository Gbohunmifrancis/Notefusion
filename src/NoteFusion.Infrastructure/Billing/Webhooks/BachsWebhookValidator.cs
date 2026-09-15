using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.Webhooks;

/// <summary>
/// Verifies Bachs webhooks. Bachs signs <c>"{timestamp}.{rawBody}"</c> — one ASCII period, no newline —
/// with HMAC-SHA256 keyed on the webhook endpoint's own <c>whsec_…</c> signing secret, and sends the
/// lowercase hex digest bare (no <c>t=</c>/<c>v1=</c>/<c>sha256=</c> prefix) in <c>X-Bachs-Signature</c>
/// — or in the unprefixed <c>Bachs-Signature</c>, which is the spelling its dashboard names — alongside
/// the Unix-seconds <c>X-Bachs-Timestamp</c>/<c>Bachs-Timestamp</c> it signed over.
/// </summary>
/// <remarks>
/// Three details here are load-bearing and easy to get wrong:
/// <list type="number">
/// <item><description>
/// The HMAC key is the UTF-8 bytes of the WHOLE secret string, <c>whsec_</c> prefix included — it is not
/// base64, so decoding it produces a valid-looking key that never matches.
/// </description></item>
/// <item><description>
/// The signing secret is per-endpoint and is NOT the API key. If it is missing we refuse every delivery
/// rather than hash with the API key: a wrong key makes genuine and forged requests indistinguishable,
/// which is the one outcome worse than being down.
/// </description></item>
/// <item><description>
/// The timestamp is part of the signed message, and it is normalised the way Bachs' own reference
/// implementations do — parsed to an integer and re-printed — so a header that is not in canonical form
/// still verifies instead of looking forged.
/// </description></item>
/// </list>
/// Everything runs on the EXACT received body, and the payload is not even parsed until the signature
/// passes — an unauthenticated body is untrusted input, not data.
/// </remarks>
internal sealed class BachsWebhookValidator : IPaymentWebhookValidator
{
    // Bachs' API reference documents the X- prefixed spelling, but its dashboard tells you to verify
    // "the Bachs-Signature header". Both V1 (bare digest) and V2 (t=...,v1=... with secret rotation)
    // are supported.
    private static readonly string[] SignatureV2Headers = ["X-Bachs-Signature-V2", "Bachs-Signature-V2"];
    private static readonly string[] SignatureHeaders = ["X-Bachs-Signature", "Bachs-Signature"];
    private static readonly string[] TimestampHeaders = ["X-Bachs-Timestamp", "Bachs-Timestamp"];

    private readonly byte[] _secret;
    private readonly long _toleranceSeconds;
    private readonly IDateTimeProvider _clock;

    public BachsWebhookValidator(BachsOptions options, IDateTimeProvider clock)
    {
        _clock = clock;
        _secret = Encoding.UTF8.GetBytes(options.WebhookSecret ?? string.Empty);
        _toleranceSeconds = Math.Max(1, options.WebhookToleranceSeconds);
    }

    public PaymentProvider Provider => PaymentProvider.Bachs;

    public Result<WebhookMessage> Validate(WebhookRequest request)
    {
        // No key, no verdict. Fail closed — see the class remarks.
        if (_secret.Length == 0)
            return Error.Unauthorized("Bachs.Webhook", "Webhook signing secret is not configured.");

        var v2Header = FirstPresent(request.Headers, SignatureV2Headers);
        var v1Signature = FirstPresent(request.Headers, SignatureHeaders);

        string? timestampHeader = FirstPresent(request.Headers, TimestampHeaders);
        long sentAtUnix;
        List<string> signatures;

        // Prefer V2 scheme (or V2 payload in V1 header if passed as t=...,v1=...).
        if (!string.IsNullOrWhiteSpace(v2Header) || (v1Signature?.Contains("t=") == true && v1Signature.Contains("v1=")))
        {
            var targetHeader = !string.IsNullOrWhiteSpace(v2Header) ? v2Header : v1Signature!;
            var parsed = ParseV2Header(targetHeader);

            var tsStr = parsed.Timestamp ?? timestampHeader;
            if (string.IsNullOrWhiteSpace(tsStr))
                return Error.Unauthorized("Bachs.Webhook", "Missing timestamp header.");

            if (!long.TryParse(tsStr.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out sentAtUnix)
                || sentAtUnix <= 0)
            {
                return Error.Unauthorized("Bachs.Webhook", "Timestamp header was not a Unix-seconds value.");
            }

            signatures = parsed.Signatures;
            if (signatures.Count == 0)
                return Error.Unauthorized("Bachs.Webhook", "Missing signature header.");
        }
        else
        {
            if (string.IsNullOrWhiteSpace(v1Signature))
                return Error.Unauthorized("Bachs.Webhook", "Missing signature header.");

            if (string.IsNullOrWhiteSpace(timestampHeader))
                return Error.Unauthorized("Bachs.Webhook", "Missing timestamp header.");

            if (!long.TryParse(timestampHeader.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out sentAtUnix)
                || sentAtUnix <= 0)
            {
                return Error.Unauthorized("Bachs.Webhook", "Timestamp header was not a Unix-seconds value.");
            }

            signatures = [v1Signature.Trim()];
        }

        // Signature before freshness, deliberately: a stale timestamp on a body we have not authenticated
        // tells us nothing, and an unsigned request must be rejected as unsigned whatever it claims the
        // time is. The timestamp goes into the message re-printed from the parsed value, which is what
        // Bachs' own Python/Node/Java samples hash.
        var expected = ComputeHmacSha256Hex(
            $"{sentAtUnix.ToString(CultureInfo.InvariantCulture)}.{request.RawBody}");
        var expectedBytes = Encoding.UTF8.GetBytes(expected);

        var match = false;
        foreach (var sig in signatures)
        {
            if (CryptographicOperations.FixedTimeEquals(expectedBytes, Encoding.UTF8.GetBytes(sig.ToLowerInvariant())))
            {
                match = true;
                break;
            }
        }

        if (!match)
            return Error.Unauthorized("Bachs.Webhook", "Signature verification failed.");

        // Now that it is provably from Bachs, bound replay of a captured delivery. Two-sided: a
        // far-future timestamp is as suspect as a stale one, and only a broken or hostile sender
        // produces either. Both operands are non-negative, so the subtraction cannot overflow.
        var nowUnix = new DateTimeOffset(DateTime.SpecifyKind(_clock.UtcNow, DateTimeKind.Utc)).ToUnixTimeSeconds();
        var skew = nowUnix >= sentAtUnix ? nowUnix - sentAtUnix : sentAtUnix - nowUnix;
        if (skew > _toleranceSeconds)
            return Error.Unauthorized("Bachs.Webhook", "Signature timestamp is outside the accepted window.");

        try
        {
            using var doc = JsonDocument.Parse(request.RawBody);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return Error.Validation("Bachs.Webhook", "Webhook body was not a JSON object.");

            var eventType = ReadString(root, "type");
            if (string.IsNullOrWhiteSpace(eventType))
                return Error.Validation("Bachs.Webhook", "Webhook carried no event type.");

            // The envelope's evt_ id IS the dedupe key, and delivery is at-least-once. Without it we
            // cannot recognise a redelivery, so we refuse rather than mint one: a synthetic id would make
            // every retry look like a new event, which is precisely the duplicate fulfilment we exist to
            // prevent. A payload missing it is malformed, not merely unusual.
            var eventId = ReadString(root, "id");
            if (string.IsNullOrWhiteSpace(eventId))
                return Error.Validation("Bachs.Webhook", "Webhook carried no event id.");

            // Our own reference, echoed back at data.reference on every payment event.
            // When data.reference is omitted (e.g. on checkout sessions), fall back to data.checkout_id or chk_ id.
            string? reference = null;
            if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object)
            {
                reference = ReadString(data, "reference") ?? ReadString(data, "checkout_id");
                if (string.IsNullOrWhiteSpace(reference))
                {
                    var dataId = ReadString(data, "id");
                    if (dataId is not null && dataId.StartsWith("chk_", StringComparison.OrdinalIgnoreCase))
                        reference = dataId;
                }
            }

            return new WebhookMessage(eventId, eventType, reference);
        }
        catch (JsonException)
        {
            return Error.Validation("Bachs.Webhook", "Webhook body was not valid JSON.");
        }
    }

    private static (string? Timestamp, List<string> Signatures) ParseV2Header(string header)
    {
        string? timestamp = null;
        var signatures = new List<string>();

        var parts = header.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var part in parts)
        {
            var eq = part.IndexOf('=');
            if (eq <= 0)
                continue;

            var key = part[..eq].Trim();
            var val = part[(eq + 1)..].Trim();

            if (string.Equals(key, "t", StringComparison.OrdinalIgnoreCase))
            {
                timestamp = val;
            }
            else if (string.Equals(key, "v1", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(val))
            {
                signatures.Add(val);
            }
        }

        return (timestamp, signatures);
    }

    private static string? FirstPresent(IReadOnlyDictionary<string, string> headers, string[] names)
    {
        foreach (var name in names)
        {
            if (headers.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value))
                return value;
        }

        return null;
    }

    private static string? ReadString(JsonElement element, string property)
        => element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private string ComputeHmacSha256Hex(string message)
    {
        using var hmac = new HMACSHA256(_secret);
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(message));
        return Convert.ToHexStringLower(hash);
    }
}
