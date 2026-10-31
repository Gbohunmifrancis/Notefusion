using System.Globalization;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.Transcriptions;

/// <summary>A push's words, as the phone (and the web push) shows them.</summary>
public sealed record ReadyPushText(string Title, string Body);

/// <summary>
/// The "your sheet is ready" push's seasonal words (Christmas, Halloween), in the product's voice (Doh lives in
/// Practice), sent while that season is on for everyone — to the phone and to the web app's browsers alike. With a hymnbook version
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

    public static readonly ReadyPushText HalloweenReady =
        new("Hey {firstName}, your sheet is ready 🎃", "{key} · {tempo} BPM. All treat, no trick: tap to review and save it.");

    public static readonly ReadyPushText HalloweenHymn =
        new("Hey {firstName}, we know this one 🎃", "It sounds like {hymn}. Tap to see your take beside the hymnbook's.");

    /// <summary>The name the title uses when the account's would not fit.</summary>
    public const string NoName = "there";

    /// <summary>The Christmas words for a finished transcription, for <paramref name="firstName"/>.</summary>
    public static ReadyPushText Christmas(string firstName, TranscriptionResultDto result)
        => Seasonal(ChristmasReady, ChristmasHymn, firstName, result);

    /// <summary>The Halloween words for a finished transcription, for <paramref name="firstName"/>.</summary>
    public static ReadyPushText Halloween(string firstName, TranscriptionResultDto result)
        => Seasonal(HalloweenReady, HalloweenHymn, firstName, result);

    /// <summary>The season's words, or null when no season is on: what the "ready" push says, phone and web alike.</summary>
    public static ReadyPushText? ForSeason(string? season, string firstName, TranscriptionResultDto result) => season switch
    {
        Core.Entities.FeatureFlag.Christmas => Christmas(firstName, result),
        Core.Entities.FeatureFlag.Halloween => Halloween(firstName, result),
        _ => null,
    };

    private static ReadyPushText Seasonal(ReadyPushText ready, ReadyPushText known, string firstName, TranscriptionResultDto result)
    {
        var hymn = result.HymnMatch is { Kind: "score" } match ? match.ShownTitle().Trim() : null;
        if (hymn is not null)
        {
            var body = Fill(known.Body, result, hymn);
            if (body.Length <= MaxBodyLength)
                return new ReadyPushText(Title(known.Title, firstName), body);
        }
        return new ReadyPushText(Title(ready.Title, firstName), Fill(ready.Body, result, hymn: null));
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
