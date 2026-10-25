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
/// id is set only from a validated access token. The browser and system are kept as family names
/// ("Chrome", "Android") and the country as its two letters: never the user agent, the address or
/// the screen size.
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
    public const int DetailMaxLength = 300;
    public const int CampaignMaxLength = 100;
    public const int CampaignNameMaxLength = 200;
    public const int FamilyMaxLength = 40;

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

    /// <summary>
    /// What else an action carries: a checkout's error code, the provider it opened, a script error's
    /// message. Null for page views and clicks.
    /// </summary>
    public string? Detail { get; private set; }

    /// <summary>
    /// The browser's device id, as the same one-way hash the previews and the trial ledger use, so an
    /// anonymous visitor's pages can be put next to the previews they ran. Null when the browser sent none.
    /// </summary>
    public string? DeviceHash { get; private set; }

    /// <summary>"mobile" or "desktop", by viewport width.</summary>
    public string Device { get; private set; } = "desktop";

    public DateTime OccurredAtUtc { get; private set; }

    /// <summary>The browser's own id for the event (<see cref="ClientEventIds"/>): a batch sent twice is stored once.</summary>
    public string? ClientId { get; private set; }

    // The link a visit came in on: its campaign tags and ?ref= (or ?via=), on the page view that began the visit only.
    public string? UtmSource { get; private set; }
    public string? UtmMedium { get; private set; }
    public string? UtmCampaign { get; private set; }
    public string? UtmTerm { get; private set; }
    public string? UtmContent { get; private set; }
    public string? Ref { get; private set; }

    /// <summary>The visitor's country (two letters), from their address at the time; the address itself is never kept.</summary>
    public string? Country { get; private set; }

    /// <summary>The browser's family, read from its user agent on arrival ("Chrome", "Safari", "Opera Mini").</summary>
    public string? Browser { get; private set; }

    /// <summary>The system's family, read the same way ("Android", "iOS", "Windows").</summary>
    public string? Os { get; private set; }

    /// <summary>
    /// Builds an event from what the browser sent, or returns null when the record is not worth
    /// keeping: an unknown kind, a click or action with no name, or missing browser ids. Every
    /// string is trimmed to its column so a hostile payload cannot fail the batch.
    /// </summary>
    public static WebEvent? TryCreate(
        string? kind, string? name, string? path, string? target, string? referrer,
        string? visitorId, string? sessionId, Guid? userId, string? device, DateTime occurredAtUtc,
        string? detail = null, string? deviceHash = null, string? clientId = null)
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
            Detail = kind == Action ? Clip(detail, DetailMaxLength) : null,
            DeviceHash = Clip(deviceHash, IdMaxLength),
            Device = device?.Trim().ToLowerInvariant() == "mobile" ? "mobile" : "desktop",
            OccurredAtUtc = occurredAtUtc,
            ClientId = ClientEventIds.Clean(clientId)
        };
    }

    /// <summary>
    /// What the request says about the visit beside the event itself: where the browser was (its country), what it is
    /// (browser and system families), and, on a page view, the campaign tags of the link it came in on.
    /// </summary>
    public WebEvent WithVisit(WebCampaign? campaign, string? country, string? browser, string? os)
    {
        if (Kind == Pageview && campaign is not null)
        {
            UtmSource = Clip(campaign.Source, CampaignMaxLength)?.ToLowerInvariant();
            UtmMedium = Clip(campaign.Medium, CampaignMaxLength)?.ToLowerInvariant();
            UtmCampaign = Clip(campaign.Campaign, CampaignNameMaxLength);
            UtmTerm = Clip(campaign.Term, CampaignNameMaxLength);
            UtmContent = Clip(campaign.Content, CampaignNameMaxLength);
            Ref = Clip(campaign.Ref, CampaignMaxLength);
        }
        // Exactly two letters or nothing: "Undefined" clipped to two would be a country nobody is in.
        country = country?.Trim().ToUpperInvariant();
        Country = country is { Length: 2 } && char.IsAsciiLetter(country[0]) && char.IsAsciiLetter(country[1]) ? country : null;
        Browser = Clip(browser, FamilyMaxLength);
        Os = Clip(os, FamilyMaxLength);
        return this;
    }

    private static string? Clip(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        value = value.Trim();
        return value.Length <= max ? value : value[..max];
    }
}

/// <summary>The campaign tags of the link a visit came in on (utm_source … utm_content) and its ?ref= or ?via= tag.</summary>
public sealed record WebCampaign(string? Source, string? Medium, string? Campaign, string? Term, string? Content, string? Ref)
{
    /// <summary>Null when the link carried none of them.</summary>
    public static WebCampaign? From(string? source, string? medium, string? campaign, string? term, string? content, string? @ref)
    {
        var c = new WebCampaign(source, medium, campaign, term, content, @ref);
        return new[] { source, medium, campaign, term, content, @ref }.All(string.IsNullOrWhiteSpace) ? null : c;
    }
}
