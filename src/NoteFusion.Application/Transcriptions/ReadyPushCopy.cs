using System.Globalization;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.Transcriptions;

/// <summary>A push's words, as the phone (and the web push) shows them.</summary>
public sealed record ReadyPushText(string Title, string Body);

/// <summary>
/// The "your sheet is ready" push's Christmas words, in the product's voice (Doh lives in Practice), sent while the
/// Christmas season is on for everyone — to the phone and to the web app's browsers alike. With a hymnbook version
/// offered (<see cref="HymnMatchDto.Kind"/> "score"), "we know this one": the result already carries the match, and the
/// line claims nothing more than the "Use the hymnbook version?" prompt does.
/// </summary>
/// <remarks>
/// Held to a phone notification's room like the practice reminders (<see cref="MaxTitleLength"/>,
/// <see cref="MaxBodyLength"/>, in UTF-16 units so an emoji counts double; the tests check a 14-letter name and the
/// longest key and tempo). A longer name is left out of the title, and a hymn title too long for the body falls back
/// to the plain ready line.
/// </remarks>
public static class ReadyPushCopy
{
    public const int MaxTitleLength = 50;
    public const int MaxBodyLength = 120;

    public static readonly ReadyPushText ChristmasReady =
        new("Hey {firstName}, your sheet is ready 🎄", "{key} · {tempo} BPM — tap to review and save it. Merry Christmas!");

    public static readonly ReadyPushText ChristmasHymn =
        new("Hey {firstName}, we know this one 🎄", "It sounds like {hymn}. Tap to see your take beside the hymnbook's.");

    /// <summary>The name the title uses when the account's would not fit.</summary>
    public const string NoName = "there";

    /// <summary>The Christmas words for a finished transcription, for <paramref name="firstName"/>.</summary>
    public static ReadyPushText Christmas(string firstName, TranscriptionResultDto result)
    {
        var hymn = result.HymnMatch is { Kind: "score" } match ? match.Title.Trim() : null;
        if (hymn is not null)
        {
            var body = Fill(ChristmasHymn.Body, result, hymn);
            if (body.Length <= MaxBodyLength)
                return new ReadyPushText(Title(ChristmasHymn.Title, firstName), body);
        }
        return new ReadyPushText(Title(ChristmasReady.Title, firstName), Fill(ChristmasReady.Body, result, hymn: null));
    }

    private static string Title(string template, string firstName)
    {
        var named = template.Replace("{firstName}", firstName, StringComparison.Ordinal);
        return named.Length <= MaxTitleLength ? named : template.Replace("{firstName}", NoName, StringComparison.Ordinal);
    }

    private static string Fill(string template, TranscriptionResultDto result, string? hymn)
        => template
            .Replace("{key}", result.Key, StringComparison.Ordinal)
            .Replace("{tempo}", result.Tempo.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{hymn}", hymn ?? string.Empty, StringComparison.Ordinal);
}
