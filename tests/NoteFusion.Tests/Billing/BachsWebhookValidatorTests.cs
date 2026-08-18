using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Billing.Webhooks;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// Pins Bachs' webhook signature scheme against an independently-computed vector. This is the boundary
/// where an unauthenticated HTTP request becomes a trusted instruction to move money, so the tests are
/// written to fail on every way the implementation could drift into accepting something it shouldn't:
/// the wrong hash algorithm, the body without its timestamp prefix, the API key used as the HMAC key, a
/// missing signing secret, and a replay from outside the window. The expected digest below was produced
/// by Python's <c>hmac</c> from the documented recipe, not by this code, so a matching implementation is
/// evidence of interoperability rather than of self-consistency.
/// </summary>
public class BachsWebhookValidatorTests
{
    private const string Secret = "whsec_test_secret";
    private const string Timestamp = "1767225600"; // 2026-01-01T00:00:00Z
    private const string Body = """{"id":"evt_1","type":"collection.succeeded","data":{"reference":"NF_abc"}}""";

    /// <summary>HMAC-SHA256("1767225600." + Body) keyed on the UTF-8 bytes of the whole whsec_ string.</summary>
    private const string ValidSignature = "3b54d4de638a608df7200c7d88d92636ce74277145d0e66acbbf935c0257f4db";

    private static readonly DateTime SignedAt = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private static BachsWebhookValidator Validator(DateTime? now = null, string secret = Secret, int tolerance = 300)
        => new(
            new BachsOptions { WebhookSecret = secret, WebhookToleranceSeconds = tolerance },
            new FixedClock(now ?? SignedAt));

    private static WebhookRequest Request(
        string body = Body, string? signature = ValidSignature, string? timestamp = Timestamp)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (signature is not null)
            headers["X-Bachs-Signature"] = signature;
        if (timestamp is not null)
            headers["X-Bachs-Timestamp"] = timestamp;

        return new WebhookRequest(body, headers);
    }

    [Fact]
    public void Genuine_delivery_verifies_and_yields_the_routing_fields()
    {
        var result = Validator().Validate(Request());

        Assert.True(result.IsSuccess);
        Assert.Equal("evt_1", result.Value.ProviderEventId);
        Assert.Equal("collection.succeeded", result.Value.EventType);
        Assert.Equal("NF_abc", result.Value.PaymentReference);
    }

    [Fact]
    public void Signature_is_case_insensitive_on_the_hex_but_not_on_the_bytes()
    {
        var result = Validator().Validate(Request(signature: ValidSignature.ToUpperInvariant()));

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public void Header_name_casing_does_not_matter()
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["x-bachs-signature"] = ValidSignature,
            ["x-bachs-timestamp"] = Timestamp,
        };

        Assert.True(Validator().Validate(new WebhookRequest(Body, headers)).IsSuccess);
    }

    [Fact]
    public void The_unprefixed_header_spelling_verifies_too()
    {
        // Bachs' API reference documents X-Bachs-Signature; its dashboard tells you to verify
        // "the Bachs-Signature header". Whichever one actually arrives has to work, because the
        // alternative is a 401 on every genuine delivery.
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Bachs-Signature"] = ValidSignature,
            ["Bachs-Timestamp"] = Timestamp,
        };

        Assert.True(Validator().Validate(new WebhookRequest(Body, headers)).IsSuccess);
    }

    [Fact]
    public void A_forgery_in_the_unprefixed_header_is_still_rejected()
    {
        // The second spelling must not become a way around verification.
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Bachs-Signature"] = new string('a', 64),
            ["Bachs-Timestamp"] = Timestamp,
        };

        var result = Validator().Validate(new WebhookRequest(Body, headers));

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, result.Error.Type);
    }

    [Fact]
    public void A_blank_prefixed_header_falls_through_to_the_unprefixed_one()
    {
        // A proxy that injects an empty X- header must not mask the real signature.
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["X-Bachs-Signature"] = "",
            ["X-Bachs-Timestamp"] = "",
            ["Bachs-Signature"] = ValidSignature,
            ["Bachs-Timestamp"] = Timestamp,
        };

        Assert.True(Validator().Validate(new WebhookRequest(Body, headers)).IsSuccess);
    }

    [Fact]
    public void A_non_canonical_timestamp_still_verifies()
    {
        // The reference implementations parse the header to an integer and re-print it into the signed
        // message, so a leading zero must not read as a forgery.
        var result = Validator().Validate(Request(timestamp: "0" + Timestamp));

        Assert.True(result.IsSuccess);
    }

    [Theory]
    // Signed with the API key rather than the endpoint's whsec_ secret. This is THE classic Bachs
    // mistake, and it must look exactly as unauthorised as a forgery.
    [InlineData("848e508f1e93ee034cafea100afbc7d3ad7cff3fe94ea21f29a27e2c4a677a16")]
    // The right key over the body alone, without the "{timestamp}." prefix.
    [InlineData("04e43d971f96d441eb2110e10f501f84dda8dcce6d9116221730141256e28a53")]
    // HMAC-SHA512 of the correct message: right key, right message, wrong algorithm.
    [InlineData("3864374d93c825ff44ed2f713b742bba57c4a56a07a64342ca4b9607628613ec80ea536904c7f83a9c6fc2f7592e9094a2bc9466df1b895517387f3d83133878")]
    // Truncated and empty digests, which a naive prefix comparison would wave through.
    [InlineData("3b54d4de")]
    [InlineData("")]
    public void A_signature_that_is_not_the_documented_digest_is_rejected(string signature)
    {
        var result = Validator().Validate(Request(signature: signature));

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, result.Error.Type);
    }

    [Fact]
    public void A_body_altered_after_signing_is_rejected()
    {
        var tampered = Body.Replace("NF_abc", "NF_xyz", StringComparison.Ordinal);

        var result = Validator().Validate(Request(body: tampered));

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, result.Error.Type);
    }

    [Fact]
    public void Whitespace_reformatting_of_the_body_is_rejected()
    {
        // Re-serializing a parsed body before verification is the documented way to break this; the test
        // exists so nobody "fixes" the controller by binding the payload to a model first.
        var result = Validator().Validate(Request(body: Body.Replace(":", ": ", StringComparison.Ordinal)));

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, result.Error.Type);
    }

    [Theory]
    [InlineData(null, Timestamp)]          // no signature header
    [InlineData(ValidSignature, null)]     // no timestamp header, so nothing to verify against
    [InlineData("   ", Timestamp)]
    [InlineData(ValidSignature, "  ")]
    [InlineData(ValidSignature, "not-a-number")]
    [InlineData(ValidSignature, "-1")]
    public void A_delivery_missing_or_mangling_either_header_is_rejected(string? signature, string? timestamp)
    {
        var result = Validator().Validate(Request(signature: signature, timestamp: timestamp));

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, result.Error.Type);
    }

    [Fact]
    public void With_no_signing_secret_configured_everything_is_rejected()
    {
        // Never fall back to the API key: a wrong key makes genuine and forged deliveries
        // indistinguishable, which is worse than being unable to accept webhooks at all.
        var result = Validator(secret: "").Validate(Request());

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, result.Error.Type);
    }

    [Theory]
    [InlineData(301)]    // stale: a captured delivery replayed later
    [InlineData(-301)]   // future: a skewed or hostile sender
    public void A_validly_signed_delivery_outside_the_window_is_rejected(int secondsLate)
    {
        var result = Validator(now: SignedAt.AddSeconds(secondsLate)).Validate(Request());

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, result.Error.Type);
    }

    [Theory]
    [InlineData(299)]
    [InlineData(-299)]
    [InlineData(0)]
    public void Ordinary_clock_skew_inside_the_window_is_accepted(int secondsLate)
        => Assert.True(Validator(now: SignedAt.AddSeconds(secondsLate)).Validate(Request()).IsSuccess);

    [Fact]
    public void An_unspecified_clock_kind_is_still_read_as_utc()
    {
        // IDateTimeProvider only promises UTC by convention; if the value arrives with Kind Unspecified,
        // interpreting it as local time would shift the window by hours and reject everything.
        var unspecified = DateTime.SpecifyKind(SignedAt, DateTimeKind.Unspecified);

        Assert.True(Validator(now: unspecified).Validate(Request()).IsSuccess);
    }

    [Fact]
    public void A_signed_body_that_is_not_json_is_a_validation_failure_not_an_auth_one()
    {
        // Correctly signed but unparseable: this came from Bachs, so it is a contract problem, and the
        // distinction matters because the two get different HTTP statuses and different diagnoses.
        const string body = "not json";
        var signature = Sign(body);

        var result = Validator().Validate(Request(body: body, signature: signature));

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Validation, result.Error.Type);
    }

    [Theory]
    // No envelope id: without it a redelivery cannot be recognised, and inventing one would guarantee
    // the duplicate fulfilment the inbox exists to prevent.
    [InlineData("""{"type":"collection.succeeded","data":{"reference":"NF_abc"}}""")]
    [InlineData("""{"id":"","type":"collection.succeeded","data":{}}""")]
    // No event type.
    [InlineData("""{"id":"evt_1","data":{"reference":"NF_abc"}}""")]
    // A JSON array is valid JSON but not an event.
    [InlineData("""["evt_1"]""")]
    public void A_signed_body_missing_its_envelope_fields_is_refused(string body)
    {
        var result = Validator().Validate(Request(body: body, signature: Sign(body)));

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Validation, result.Error.Type);
    }

    [Theory]
    // Nullable at the source, and legitimately absent on events that are not about a checkout of ours.
    [InlineData("""{"id":"evt_2","type":"invoice.paid","data":{"reference":null}}""")]
    [InlineData("""{"id":"evt_2","type":"invoice.paid","data":{}}""")]
    [InlineData("""{"id":"evt_2","type":"invoice.paid"}""")]
    public void A_missing_reference_is_reported_as_null_rather_than_failing(string body)
    {
        var result = Validator().Validate(Request(body: body, signature: Sign(body)));

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.PaymentReference);
    }

    /// <summary>Signs a body the way Bachs does, for cases where a fixed vector would be unreadable.</summary>
    private static string Sign(string body)
    {
        using var hmac = new System.Security.Cryptography.HMACSHA256(
            System.Text.Encoding.UTF8.GetBytes(Secret));
        return Convert.ToHexStringLower(
            hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"{Timestamp}.{body}")));
    }
}
