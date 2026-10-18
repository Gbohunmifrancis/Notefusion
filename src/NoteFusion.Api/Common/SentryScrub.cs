using System.Text.RegularExpressions;
using Sentry;

namespace NoteFusion.Api.Common;

/// <summary>
/// Nothing sent to Sentry identifies a person. With SendDefaultPii off the SDK keeps request bodies, cookies,
/// IP addresses and the Authorization header back, but still sends the other headers (X-Device-Id is a device
/// identifier) and the query string (an unsubscribe link's token and address): those go here. And the one
/// piece of personal data our own log lines carry, an email address, is masked wherever it can travel: an
/// event's message, its tags and extras (a log line's string properties become tags), its exceptions, the
/// request's address, and every breadcrumb (the Information lines logged before an error).
/// </summary>
public static partial class SentryScrub
{
    /// <summary>What an email address is replaced with.</summary>
    public const string Mask = "[email]";

    [GeneratedRegex(@"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", RegexOptions.CultureInvariant)]
    private static partial Regex EmailAddress();

    /// <summary>The text with every email address masked.</summary>
    public static string? Text(string? value) => value is null ? null : EmailAddress().Replace(value, Mask);

    /// <summary>Masks an event in place before it is sent (<c>SentryOptions.SetBeforeSend</c>).</summary>
    public static SentryEvent Event(SentryEvent sentryEvent)
    {
        if (sentryEvent.Message is { } message)
        {
            sentryEvent.Message = new SentryMessage
            {
                Message = Text(message.Message),
                Formatted = Text(message.Formatted),
                Params = message.Params?.Select(p => p is string s ? Text(s)! : p).ToList(),
            };
        }

        foreach (var (key, value) in sentryEvent.Tags.ToList())
        {
            var masked = Text(value);
            if (masked != value) sentryEvent.SetTag(key, masked!);
        }

        foreach (var (key, value) in sentryEvent.Extra.ToList())
        {
            if (value is string s && Text(s) != s) sentryEvent.SetExtra(key, Text(s));
        }

        foreach (var exception in sentryEvent.SentryExceptions ?? [])
        {
            exception.Value = Text(exception.Value);
        }

        // The method and the path stay: they say which endpoint failed.
        var request = sentryEvent.Request;
        request.Headers.Clear();
        request.Cookies = null;
        request.QueryString = null;
        request.Data = null;
        request.Url = Text(request.Url);

        return sentryEvent;
    }

    /// <summary>Masks a breadcrumb before it is kept (<c>SentryOptions.SetBeforeBreadcrumb</c>).</summary>
    public static Breadcrumb Breadcrumb(Breadcrumb breadcrumb)
    {
        var message = Text(breadcrumb.Message);
        var data = breadcrumb.Data?.ToDictionary(kv => kv.Key, kv => Text(kv.Value)!);
        var unchanged = message == breadcrumb.Message
            && (breadcrumb.Data is null || breadcrumb.Data.All(kv => data![kv.Key] == kv.Value));
        return unchanged
            ? breadcrumb
            // Masked as it is recorded, so the new breadcrumb's own time (now) is the original's.
            : new Breadcrumb(message!, breadcrumb.Type!, data, breadcrumb.Category, breadcrumb.Level);
    }
}
