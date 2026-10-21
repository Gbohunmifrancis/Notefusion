using NoteFusion.Application.Practice;

namespace NoteFusion.Application.Offers;

/// <summary>An offer email's four editable parts. <c>{pct}</c> anywhere in them reads as the offer's percent.</summary>
public sealed record OfferWords(string Subject, string Preheader, string Headline, string Body);

/// <summary>
/// One skin an offer can wear (<see cref="OfferTemplates"/>): its name, the line its banner and email say ("Halloween
/// offer"), the default last day and start, and the default words.
/// </summary>
/// <param name="Template">"halloween" or "christmas": what the offer row stores.</param>
/// <param name="Season">"Halloween": the name's first word.</param>
/// <param name="Label">"Halloween offer": the banner's and the email's line, and the ended sentence's subject.</param>
/// <param name="LastMonth">The default last day's month.</param>
/// <param name="LastDayOfMonth">The default last day's day (31 October, 26 December).</param>
/// <param name="StartsDaysBefore">The default start is the Monday on or before this many days before the last day, 09:00 UK.</param>
/// <param name="Words">The default email words.</param>
public sealed record OfferTemplate(
    string Template, string Season, string Label, int LastMonth, int LastDayOfMonth, int StartsDaysBefore, OfferWords Words)
{
    /// <summary>The default last day in <paramref name="year"/>.</summary>
    public DateOnly LastDayIn(int year) => new(year, LastMonth, LastDayOfMonth);

    /// <summary>The default start for a last day: the Monday on or before <see cref="StartsDaysBefore"/> days earlier, 09:00 UK time.</summary>
    public DateTime StartsAtUtcFor(DateOnly lastDay)
    {
        var day = lastDay.AddDays(-StartsDaysBefore);
        day = day.AddDays(-(((int)day.DayOfWeek + 6) % 7));
        var local = day.ToDateTime(new TimeOnly(OfferTemplates.StartHour, 0), DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(local, OfferWindow.DefaultZone);
    }

    /// <summary>The next one whose last day has not gone: this year's, or next year's once it has.</summary>
    public DateOnly NextLastDay(DateTime utcNow)
    {
        var today = PracticeTime.LocalDate(utcNow, OfferWindow.DefaultZone);
        var lastDay = LastDayIn(today.Year);
        return lastDay < today ? LastDayIn(today.Year + 1) : lastDay;
    }

    /// <summary>"Halloween 2026".</summary>
    public string NameFor(DateOnly lastDay) => $"{Season} {lastDay.Year}";
}

/// <summary>
/// The skins an offer can wear. A template is only a skin: the email's header art (<c>/email/season-{template}.png</c>),
/// the line's colour, the price box's tint and the default words; the offer, the email layout and the banner are one.
/// </summary>
public static class OfferTemplates
{
    public const string Halloween = "halloween";
    public const string Christmas = "christmas";
    public const int StartHour = 9;
    public const int DefaultPercentOff = 30;

    /// <summary>Where the percent goes in an offer's words.</summary>
    public const string PercentToken = "{pct}";

    public static readonly OfferTemplate HalloweenTemplate = new(
        Halloween, "Halloween", "Halloween offer", 10, 31, 5,
        new OfferWords(
            "{pct}% off Pro, until Halloween",
            "Whole songs, four parts and Sing it back, monthly or yearly, until 31 October.",
            "Pro is {pct}% off until Halloween",
            "Whatever your choir is learning this autumn, Pro writes out the whole song, adds alto, tenor and bass under the "
            + "tune, and listens while you sing your part back.\n\nFor the rest of October, Pro is {pct}% off, monthly or yearly."));

    public static readonly OfferTemplate ChristmasTemplate = new(
        Christmas, "Christmas", "Christmas offer", 12, 26, 12,
        new OfferWords(
            "{pct}% off Pro for Christmas",
            "Whole songs, four parts and Sing it back, monthly or yearly, until 26 December.",
            "Pro is {pct}% off for Christmas",
            "Whatever your choir is singing this Christmas, Pro writes out the whole carol, adds alto, tenor and bass under "
            + "the tune, and listens while you sing your part back.\n\nUntil Boxing Day, Pro is {pct}% off, monthly or yearly."));

    public static readonly IReadOnlyList<OfferTemplate> All = [HalloweenTemplate, ChristmasTemplate];

    public static OfferTemplate? Find(string? template)
        => All.FirstOrDefault(t => string.Equals(t.Template, template?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>"Halloween offer"; "offer" for a template no longer known.</summary>
    public static string LabelOf(string? template) => Find(template)?.Label ?? "offer";

    /// <summary>The words with <see cref="PercentToken"/> written as the percent.</summary>
    public static string Fill(string words, int percentOff)
        => words.Replace(PercentToken, percentOff.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal);

    /// <summary>The offer's key: the template and the start's year (<c>halloween-2026</c>).</summary>
    public static string KeyFor(string template, DateTime startsAtUtc) => $"{template}-{startsAtUtc.Year}";
}
