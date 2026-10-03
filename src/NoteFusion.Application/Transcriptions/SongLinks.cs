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
/// <c>i=</c> song id anywhere in the query).
/// </remarks>
public static partial class SongLinks
{
    /// <summary>The longest link passed on; anything longer is not a share link.</summary>
    public const int MaxLength = 2048;

    // A link that ends a sentence or sits in brackets drags these along when pasted.
    private const string Trailing = ".,;:!?)]}>'\"’”»…";

    [GeneratedRegex("""https?://[^\s<>"]+""", RegexOptions.IgnoreCase)]
    private static partial Regex UrlInText();

    [GeneratedRegex("^[A-Za-z0-9_-]{11}$")]
    private static partial Regex VideoId();

    [GeneratedRegex("^/(?:intl-[A-Za-z-]+/)?track/([A-Za-z0-9]+)/?$")]
    private static partial Regex SpotifyTrackPath();

    /// <summary>
    /// The first http(s) link in <paramref name="text"/>, trailing punctuation trimmed, when it is a song
    /// on a supported service; false (and an empty <paramref name="url"/>) otherwise.
    /// </summary>
    public static bool TryExtract(string? text, out string url)
    {
        url = string.Empty;
        var match = UrlInText().Match(text ?? string.Empty);
        if (!match.Success)
            return false;

        var candidate = match.Value.TrimEnd(Trailing.ToCharArray());
        if (candidate.Length <= "https://".Length || candidate.Length > MaxLength)
            return false;
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            return false;
        if (!IsYouTubeVideo(uri) && !IsSpotifyTrack(uri) && !IsAppleMusicSong(uri))
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
