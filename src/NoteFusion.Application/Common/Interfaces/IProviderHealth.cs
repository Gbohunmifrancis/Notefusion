using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Whether an outside provider's circuit breaker is open: it failed often enough lately that calls to it are
/// being refused unsent. Background batches ask before each item and stop for the run when it is, because
/// every call would be refused and a batch that claims an item before sending would spend it on nothing;
/// the next run starts again. A request a person is waiting on need not ask: a refused call comes back as
/// that provider's ordinary "unavailable" result.
/// </summary>
public interface IProviderHealth
{
    /// <param name="provider">One of <see cref="OutboundProviders"/>.</param>
    bool IsUnavailable(string provider);
}

public static class ProviderHealth
{
    /// <summary>For callers built without one (tests, a provider never wired up): nothing is ever down.</summary>
    public static readonly IProviderHealth AlwaysAvailable = new NeverDown();

    private sealed class NeverDown : IProviderHealth
    {
        public bool IsUnavailable(string provider) => false;
    }
}

/// <summary>The names <see cref="IProviderHealth"/> knows the outside providers by.</summary>
public static class OutboundProviders
{
    public const string Email = "resend";
    public const string EmailInbox = "resend-inbox";
    public const string Push = "expo";
    public const string WebPush = "webpush";
    public const string Transcription = "transcriber";
    public const string GeoIp = "geoip";
    public const string Gemini = "gemini";
    public const string GitHub = "github";
    public const string Website = "website";

    /// <summary>"paystack", "bachs", "flutterwave": also the name of that provider's HttpClient.</summary>
    public static string Payment(PaymentProvider provider) => provider.ToString().ToLowerInvariant();
}
