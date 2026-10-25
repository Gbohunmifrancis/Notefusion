namespace NoteFusion.Application.Web;

/// <summary>
/// The browser and system a User-Agent names, as families ("Chrome", "Android") and nothing finer: no versions, no
/// device models. The traffic page groups visitors by these; the string itself is never kept.
/// </summary>
/// <remarks>
/// Order matters, because user agents borrow from one another: Edge, Opera, Samsung Internet and the in-app browsers all
/// say "Chrome", and Chrome says "Safari". So the specific ones are tried first. A crawler that runs scripts (Google's
/// renderer, a headless browser, Lighthouse) is <see cref="Agent.IsBot"/>, and its events are not a visitor's.
/// </remarks>
public static class UserAgentFamily
{
    public sealed record Agent(string? Browser, string? Os, bool IsBot);

    private static readonly string[] BotWords =
        ["bot", "crawler", "spider", "slurp", "headless", "lighthouse", "pagespeed", "phantomjs", "puppeteer", "playwright",
         "facebookexternalhit", "embedly", "preview", "python-requests", "curl/", "wget"];

    private static readonly (string Token, string Family)[] Browsers =
    [
        ("FBAN", "Facebook in-app"), ("FBAV", "Facebook in-app"), ("Instagram", "Instagram in-app"),
        ("Snapchat", "Snapchat in-app"), ("TikTok", "TikTok in-app"), ("musical_ly", "TikTok in-app"),
        ("Opera Mini", "Opera Mini"), ("OPiOS", "Opera"), ("OPR/", "Opera"), ("Opera", "Opera"),
        ("SamsungBrowser", "Samsung Internet"), ("UCBrowser", "UC Browser"), ("MiuiBrowser", "Mi Browser"),
        ("YaBrowser", "Yandex"), ("EdgiOS", "Edge"), ("EdgA/", "Edge"), ("Edg/", "Edge"),
        ("CriOS", "Chrome"), ("FxiOS", "Firefox"), ("Firefox/", "Firefox"),
        ("Chrome/", "Chrome"), ("Chromium/", "Chrome"), ("Safari/", "Safari"),
    ];

    private static readonly (string Token, string Family)[] Systems =
    [
        ("iPhone", "iOS"), ("iPad", "iOS"), ("iPod", "iOS"), ("Android", "Android"), ("CrOS", "ChromeOS"),
        ("Windows", "Windows"), ("Macintosh", "macOS"), ("Mac OS X", "macOS"), ("Linux", "Linux"),
    ];

    public static Agent Read(string? userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent))
            return new Agent(null, null, false);
        var ua = userAgent.Trim();
        if (BotWords.Any(w => ua.Contains(w, StringComparison.OrdinalIgnoreCase)))
            return new Agent(null, null, true);
        return new Agent(First(ua, Browsers) ?? "Other", First(ua, Systems) ?? "Other", false);
    }

    private static string? First(string ua, (string Token, string Family)[] table)
    {
        foreach (var (token, family) in table)
            if (ua.Contains(token, StringComparison.Ordinal))
                return family;
        return null;
    }
}
