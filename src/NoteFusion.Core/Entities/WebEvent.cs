using NoteFusion.Core.Seedwork;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One thing a visitor did on the website or in the web app: a page viewed, a link or button
/// clicked, or a named action taken in the app (a tune recorded, a sheet saved, a checkout
/// started). First-party and account-linked when the visitor is signed in, so the dashboard can
/// show both how the site is used and what each web account goes on to do.
/// </summary>
/// <remarks>
/// Nothing here identifies a person on its own: the visitor and session ids are random strings
/// the browser made up and keeps in its own storage, the referrer is a host name, and the user
/// id is set only from a validated access token. No user agent, no address, no screen size.
/// </remarks>
public class WebEvent : BaseEntity
{
    public const string Pageview = "pageview";
    public const string Click = "click";
    public const string Action = "action";

    public const int NameMaxLength = 120;
    public const int PathMaxLength = 200;
    public const int TargetMaxLength = 200;
    public const int ReferrerMaxLength = 120;
    public const int IdMaxLength = 64;

    private WebEvent() { } // EF Core

    /// <summary><see cref="Pageview"/>, <see cref="Click"/> or <see cref="Action"/>.</summary>
    public string Kind { get; private set; } = Pageview;

    /// <summary>The clicked control's label, or the action's name; null for a page view.</summary>
    public string? Name { get; private set; }

    /// <summary>The page's path, without its query string.</summary>
    public string Path { get; private set; } = "/";

    /// <summary>Where a clicked link points (path and query), so a "Sign up" link can be told from a "Sign up" button.</summary>
    public string? Target { get; private set; }

    /// <summary>The referring site's host, when the visit came from another site; null for direct and same-site.</summary>
    public string? Referrer { get; private set; }

    /// <summary>A random id the browser keeps across visits; the floor on "distinct visitors".</summary>
    public string VisitorId { get; private set; } = string.Empty;

    /// <summary>A random id the browser keeps for one tab session.</summary>
    public string SessionId { get; private set; } = string.Empty;

    /// <summary>The signed-in account, from the access token the browser sent; null for a visitor.</summary>
    public Guid? UserId { get; private set; }

    /// <summary>"mobile" or "desktop", by viewport width.</summary>
    public string Device { get; private set; } = "desktop";

    public DateTime OccurredAtUtc { get; private set; }

    /// <summary>
    /// Builds an event from what the browser sent, or returns null when the record is not worth
    /// keeping: an unknown kind, a click or action with no name, or missing browser ids. Every
    /// string is trimmed to its column so a hostile payload cannot fail the batch.
    /// </summary>
    public static WebEvent? TryCreate(
        string? kind, string? name, string? path, string? target, string? referrer,
        string? visitorId, string? sessionId, Guid? userId, string? device, DateTime occurredAtUtc)
    {
        kind = kind?.Trim().ToLowerInvariant();
        if (kind is not (Pageview or Click or Action))
            return null;

        name = Clip(name, NameMaxLength);
        if (kind != Pageview && name is null)
            return null;

        visitorId = Clip(visitorId, IdMaxLength);
        sessionId = Clip(sessionId, IdMaxLength);
        if (visitorId is null || sessionId is null)
            return null;

        return new WebEvent
        {
            Id = Guid.NewGuid(),
            Kind = kind,
            Name = kind == Pageview ? null : name,
            Path = Clip(path, PathMaxLength) ?? "/",
            Target = kind == Click ? Clip(target, TargetMaxLength) : null,
            Referrer = Clip(referrer, ReferrerMaxLength),
            VisitorId = visitorId,
            SessionId = sessionId,
            UserId = userId,
            Device = device?.Trim().ToLowerInvariant() == "mobile" ? "mobile" : "desktop",
            OccurredAtUtc = occurredAtUtc
        };
    }

    private static string? Clip(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        value = value.Trim();
        return value.Length <= max ? value : value[..max];
    }
}
