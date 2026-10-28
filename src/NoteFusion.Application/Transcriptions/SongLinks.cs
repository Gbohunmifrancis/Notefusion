using System.Text.RegularExpressions;

namespace NoteFusion.Application.Transcriptions;

/// <summary>
/// Finds the link in what a user pasted, so only the link itself is sent on: share sheets wrap it in words ("Listen to
/// … on Spotify: https://…") and a link that ends a sentence brings its full stop. Mirrors the worker's
/// <c>extract_url</c> (server/app/ingest/links.py).
/// </summary>
/// <remarks>
/// Whether the link is a song we can read (and which service) is the worker's <c>provider_of</c> alone, the one parser:
/// a link it cannot use comes back as its 422 (<c>not_a_song_link</c>, step "parse"), which the API answers with
/// <see cref="Common.Errors.TranscriptionErrors.InvalidLink"/>. Nothing here or in the clients refuses a link the
/// worker would read.
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

    /// <summary>
    /// The first http(s) link in <paramref name="text"/> (or, without one, the first link to a supported service typed
    /// without its scheme, read as https://), trailing punctuation trimmed; false (and an empty <paramref name="url"/>)
    /// when the text holds no link at all.
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

        url = candidate;
        return true;
    }
}
