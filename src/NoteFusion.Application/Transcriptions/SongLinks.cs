using System.Text.RegularExpressions;

namespace NoteFusion.Application.Transcriptions;

/// <summary>
/// Finds the song link in what a user pasted. Mirrors the worker's <c>extract_url</c> / <c>provider_of</c>
/// (server/app/ingest/links.py), which stays the authority: this copy exists so a link the worker would
/// refuse is refused at once with a plain message, and so only the link itself is sent on — share sheets
/// wrap it in words ("Listen to … on Spotify: https://…") and a link that ends a sentence brings its full stop.
/// </summary>
/// <remarks>
/// Accepted: a YouTube video (youtube.com and any subdomain — www., m., music. — with <c>/watch?v=</c>,
/// <c>/shorts/</c>, <c>/live/</c>, <c>/embed/</c> or <c>/v/</c>, and youtu.be/&lt;id&gt;); a Spotify track
/// (open.spotify.com/(intl-xx/)track/&lt;id&gt;, or a spotify.link / spotify.app.link short link); an Apple
/// Music song (music.apple.com or geo.music.apple.com /&lt;country&gt;/song/…/&lt;id&gt;, or /album/… with an
/// <c>i=</c> song id anywhere in the query); an Instagram reel or post (instagram.com, www., m. with
/// <c>/reel/</c>, <c>/reels/</c>, <c>/p/</c> or <c>/tv/</c>, also under a profile); a TikTok video
/// (tiktok.com/@&lt;user&gt;/video/&lt;id&gt;, m.tiktok.com/v/&lt;id&gt;.html, or a vm./vt.tiktok.com or tiktok.com/t/ short link).
/// </remarks>
public static partial class SongLinks
{
    /// <summary>The longest link passed on; anything longer is not a share link.</summary>
    public const int MaxLength = 2048;

    // A link that ends a sentence or sits in brackets drags these along when pasted.
    private const string Trailing = ".,;:!?)]}>'\"’”»…";

    [GeneratedRegex("""https?://[^\s<>"]+""", RegexOptions.IgnoreCase)]
    private static partial Regex UrlInText();

    // A link to one of the services typed without its scheme ("youtube.com/watch?v=…"), read as https://.
    [GeneratedRegex("""(?:^|[\s(\[<"'“‘«])((?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|spotify\.com|spotify\.link|app\.link|apple\.com|instagram\.com|tiktok\.com)/[^\s<>"]+)""", RegexOptions.IgnoreCase)]
    private static partial Regex BareLink();

    [GeneratedRegex("^[A-Za-z0-9_-]{11}$")]
    private static partial Regex VideoId();

    [GeneratedRegex("^/(?:intl-[A-Za-z-]+/)?track/([A-Za-z0-9]+)/?$")]
    private static partial Regex SpotifyTrackPath();

    [GeneratedRegex("^[A-Za-z0-9_-]{5,64}$")]
    private static partial Regex InstagramCode();

    [GeneratedRegex("^[0-9]{8,24}$")]
    private static partial Regex TikTokId();

    [GeneratedRegex("^[A-Za-z0-9_-]{4,32}$")]
    private static partial Regex ShortCode();

    /// <summary>
    /// The first http(s) link in <paramref name="text"/> (or, without one, the first link to a supported service typed
    /// without its scheme, read as https://), trailing punctuation trimmed, when it is a song on a supported service;
    /// false (and an empty <paramref name="url"/>) otherwise.
    /// </summary>
    public static bool TryExtract(string? text, out string url)
    {
        url = string.Empty;
        var match = UrlInText().Match(text ?? string.Empty);
        string raw;
        if (match.Success)
            raw = match.Value;
        else
        {
            var bare = BareLink().Match(text ?? string.Empty);
            if (!bare.Success)
                return false;
            raw = "https://" + bare.Groups[1].Value;
        }

        var candidate = raw.TrimEnd(Trailing.ToCharArray());
        if (candidate.Length <= "https://".Length || candidate.Length > MaxLength)
            return false;
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            return false;
        if (!IsYouTubeVideo(uri) && !IsSpotifyTrack(uri) && !IsAppleMusicSong(uri) && !IsInstagramVideo(uri) && !IsTikTokVideo(uri))
            return false;

        url = candidate;
        return true;
    }

    private static bool IsYouTubeVideo(Uri uri)
    {
        var host = uri.Host.ToLowerInvariant();
        var parts = Segments(uri);
        string? id;
        if (host is "youtu.be" or "www.youtu.be")
            id = parts.FirstOrDefault();
        else if (host == "youtube.com" || host.EndsWith(".youtube.com", StringComparison.Ordinal))
            id = parts switch
            {
                [("shorts" or "embed" or "live" or "v"), var video, ..] => video,
                ["watch"] => Query(uri, "v"),
                _ => null
            };
        else
            return false;
        return id is not null && VideoId().IsMatch(id);
    }

    private static bool IsSpotifyTrack(Uri uri)
    {
        var host = uri.Host.ToLowerInvariant();
        if (host == "open.spotify.com")
            return SpotifyTrackPath().IsMatch(uri.AbsolutePath);
        // A short link only names its track once followed; the worker expands it.
        return host is "spotify.link" or "spotify.app.link" && uri.AbsolutePath.Trim('/').Length > 0;
    }

    private static bool IsAppleMusicSong(Uri uri)
    {
        var host = uri.Host.ToLowerInvariant();
        if (host is not ("music.apple.com" or "geo.music.apple.com"))
            return false;
        // /<country>/(song|album)/<slug>/<id>, the slug sometimes missing.
        var parts = Segments(uri);
        if (parts.Length < 3 || parts[1] is not ("song" or "album"))
            return false;
        var id = parts[1] == "album" ? Query(uri, "i") : parts[^1];
        return !string.IsNullOrEmpty(id) && id.All(char.IsAsciiDigit);
    }

    private static bool IsInstagramVideo(Uri uri)
    {
        if (uri.Host.ToLowerInvariant() is not ("instagram.com" or "www.instagram.com" or "m.instagram.com"))
            return false;
        // /<kind>/<code>/ or /<user>/<kind>/<code>/
        var parts = Segments(uri);
        for (var i = 0; i < Math.Min(2, parts.Length); i++)
            if (parts[i] is "reel" or "reels" or "p" or "tv" && i + 1 < parts.Length && InstagramCode().IsMatch(parts[i + 1]))
                return true;
        return false;
    }

    private static bool IsTikTokVideo(Uri uri)
    {
        var host = uri.Host.ToLowerInvariant();
        var parts = Segments(uri);
        // A short link only names its video once followed; the worker's yt-dlp follows it.
        if (host is "vm.tiktok.com" or "vt.tiktok.com")
            return parts is [var code] && ShortCode().IsMatch(code);
        if (host is not ("tiktok.com" or "www.tiktok.com" or "m.tiktok.com"))
            return false;
        return parts switch
        {
            ["t", var code] => ShortCode().IsMatch(code),
            [var user, "video", var id] => user.StartsWith('@') && TikTokId().IsMatch(id),
            ["v", var page] => page.EndsWith(".html", StringComparison.Ordinal) && TikTokId().IsMatch(page[..^5]),
            _ => false
        };
    }

    private static string[] Segments(Uri uri)
        => uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);

    /// <summary>The first value of a query parameter, or null.</summary>
    private static string? Query(Uri uri, string name)
    {
        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=');
            var key = eq < 0 ? pair : pair[..eq];
            if (Uri.UnescapeDataString(key) == name)
                return eq < 0 ? string.Empty : Uri.UnescapeDataString(pair[(eq + 1)..]);
        }
        return null;
    }
}
