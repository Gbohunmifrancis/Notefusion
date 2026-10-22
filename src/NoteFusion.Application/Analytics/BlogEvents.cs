using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Analytics;

/// <summary>
/// The blog's own web-app actions, as <c>web-site/assets/blog-track.js</c> records them through track.js
/// (<see cref="WebEvent.Action"/> rows on a blog, hymn, free tool or comparison page's path), and how their details
/// are read.
/// </summary>
/// <remarks>
/// A detail is a short <c>key=value;key=value</c> list (<see cref="ParseDetail"/>); every one carries
/// <c>pv</c>, a random id for the page load, so a read, its engagement report and its clicks can be put
/// together. The thresholds here are the server's own copy of the script's: a read the browser reports is
/// only counted when its own numbers meet them, so an old or tampered script cannot lower the bar.
/// </remarks>
public static class BlogEvents
{
    public const string View = "blog_view";
    public const string Read = "blog_read";
    public const string ReadComplete = "blog_read_complete";
    public const string Engagement = "blog_engagement";
    public const string CtaClick = "blog_cta_click";
    public const string Share = "blog_share";
    public const string HymnPlay = "hymn_play";

    /// <summary>
    /// A 30-second preview started from the try box a free tool page carries (the home page's own,
    /// <c>web-site/assets/preview.js</c>): a recording or a file, or a song link.
    /// </summary>
    public const string ConverterTryAudio = "Preview started (audio)", ConverterTryLink = "Preview started (link)";

    /// <summary>A read: at least this share of the article scrolled past…</summary>
    public const int ReadDepthPercent = 50;

    /// <summary>…and at least this long with the tab visible.</summary>
    public const int ReadActiveSeconds = 30;

    /// <summary>A complete read: this share of the article scrolled past (the 100 bucket).</summary>
    public const int CompleteDepthPercent = 90;

    /// <summary>The source labels a view is put under.</summary>
    public const string Search = "search", Social = "social", Direct = "direct", Internal = "internal", Other = "other";

    /// <summary>
    /// "pv=a1;depth=75;active=42" → { pv: a1, depth: 75, active: 42 }. Unknown keys are kept, malformed pairs
    /// are skipped, and a null or empty detail is an empty map.
    /// </summary>
    public static IReadOnlyDictionary<string, string> ParseDetail(string? detail)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(detail))
            return map;
        foreach (var pair in detail.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=');
            if (eq <= 0)
                continue;
            var key = pair[..eq].Trim();
            var value = pair[(eq + 1)..].Trim();
            if (key.Length > 0 && value.Length > 0)
                map[key] = value;
        }
        return map;
    }

    /// <summary>A whole number from a detail, or null when it is missing or not a number.</summary>
    public static int? Number(IReadOnlyDictionary<string, string> detail, string key)
        => detail.TryGetValue(key, out var raw) && int.TryParse(raw, out var n) && n >= 0 ? n : null;

    /// <summary>Whether a page load's own numbers make it a read: both thresholds met.</summary>
    public static bool IsGenuineRead(int? depthPercent, int? activeSeconds)
        => depthPercent >= ReadDepthPercent && activeSeconds >= ReadActiveSeconds;

    /// <summary>
    /// Whether a path is one of the blog's, the hymns', the free tools' or the comparisons' pages, as track.js records
    /// it (no query string, no trailing slash). Written as a plain expression so it translates to SQL.
    /// </summary>
    public static bool IsContentPath(string path)
        => path == "/blog" || path.StartsWith("/blog/") || path == "/hymns" || path.StartsWith("/hymns/")
           || path == "/tools" || path.StartsWith("/tools/") || path.StartsWith("/compare/");

    /// <summary>The path as it is grouped: lowercase, no trailing slash, no <c>/index.html</c>.</summary>
    public static string NormalisePath(string path)
    {
        var p = path.Trim().ToLowerInvariant();
        if (p.EndsWith("/index.html", StringComparison.Ordinal))
            p = p[..^"/index.html".Length];
        p = p.TrimEnd('/');
        return p.Length == 0 ? "/" : p;
    }

    /// <summary>
    /// "post", "hymn", "tool" (a free tool page), "compare" (NoteFusion beside another app), or "index" (the front
    /// page, its pages, tags, authors, the hymn list and the tools' list).
    /// </summary>
    public static string KindOf(string normalisedPath)
    {
        var parts = normalisedPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 2 && parts[0] == "hymns")
            return "hymn";
        if (parts.Length == 2 && parts[0] == "blog" && parts[1] != "page")
            return "post";
        if (parts.Length == 2 && parts[0] == "tools")
            return "tool";
        if (parts.Length == 2 && parts[0] == "compare")
            return "compare";
        return "index";
    }

    /// <summary>The opened app: the web app's own pages.</summary>
    public static bool IsAppPath(string path) => path == "/app" || path.StartsWith("/app/");

    private static readonly string[] SearchHosts =
        ["google.", "bing.com", "duckduckgo.com", "yahoo.", "yandex.", "baidu.com", "ecosia.org", "search.brave.com", "startpage.com", "qwant.com", "ask.com", "googlequicksearchbox"];

    private static readonly string[] SocialHosts =
        ["whatsapp", "wa.me", "facebook.com", "fb.com", "fb.me", "instagram.com", "t.co", "x.com", "twitter.com", "linkedin.com", "lnkd.in",
         "reddit.com", "pinterest.", "tiktok.com", "youtube.com", "youtu.be", "t.me", "telegram.", "snapchat.com", "threads.net", "quora.com"];

    /// <summary>
    /// Where a referring host puts a visit: search, social or other; direct when there is none. The same
    /// lists as blog-track.js, used for page views recorded before the script sent its own label.
    /// </summary>
    public static string SourceOfHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host))
            return Direct;
        var h = host.Trim().ToLowerInvariant();
        if (h is "notefusion.studio" or "www.notefusion.studio")
            return Internal;
        if (SearchHosts.Any(s => Matches(h, s)))
            return Search;
        if (SocialHosts.Any(s => Matches(h, s)))
            return Social;
        return Other;
    }

    /// <summary>A label from the browser, kept only when it is one of the known ones.</summary>
    public static string KnownSource(string? label)
        => label is Search or Social or Direct or Internal or Other ? label : Other;

    /// <summary>
    /// A list entry ending in "." matches a label anywhere ("google." matches google.com and google.com.ng);
    /// any other is a whole host or a dotted suffix of one ("t.co" matches t.co, not reddit.com), or a
    /// bare word inside an app id ("whatsapp").
    /// </summary>
    private static bool Matches(string host, string entry)
    {
        if (entry.EndsWith('.'))
            return host.StartsWith(entry, StringComparison.Ordinal) || host.Contains("." + entry, StringComparison.Ordinal);
        if (!entry.Contains('.'))
            return host.Contains(entry, StringComparison.Ordinal);
        return host == entry || host.EndsWith("." + entry, StringComparison.Ordinal);
    }
}
