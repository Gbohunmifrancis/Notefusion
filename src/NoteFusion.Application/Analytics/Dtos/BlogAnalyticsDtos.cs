namespace NoteFusion.Application.Analytics.Dtos;

/// <summary>The console's Blog analytics page: the blog's readers and what they went on to do in the product.</summary>
/// <param name="AttributionWindowDays">How long after a visitor's first blog page a step still counts for the blog.</param>
public sealed record BlogAnalyticsDto(
    DateTime FromUtc,
    DateTime ToUtc,
    int ReportingOffsetMinutes,
    int AttributionWindowDays,
    BlogKpisDto Kpis,
    IReadOnlyList<BlogFunnelStageDto> Funnel,
    IReadOnlyList<BlogPostRowDto> Posts,
    IReadOnlyList<BlogSourceRowDto> Sources,
    IReadOnlyList<BlogEntryRowDto> TopEntries,
    IReadOnlyList<BlogCampaignRowDto> Campaigns,
    IReadOnlyList<BlogShareRowDto> Shares,
    IReadOnlyList<BlogDailyDto> Daily);

/// <param name="Visitors">Distinct browsers that viewed a blog or hymn page in the window, new or returning.</param>
/// <param name="NewVisitors">Of those, the ones whose first blog page on record is in the window (the funnel's cohort).</param>
/// <param name="Readers">Browsers with a genuine read in the window (half the article and 30 s visible).</param>
/// <param name="ReadRate">Readers over visitors; null with no visitors.</param>
/// <param name="AvgActiveSeconds">Mean visible seconds per page view that reported its engagement; null with none.</param>
/// <param name="SignupsFromBlog">First-touch: new visitors who made an account within the window after their first blog page.</param>
/// <param name="TranscribersFromBlog">First-touch: new visitors who made a first transcription (or an anonymous preview) within the window.</param>
/// <param name="PayersFromBlog">First-touch: new visitors whose account paid within the window.</param>
/// <param name="AssistedSignups">Accounts created in the window whose browser had seen any blog page before signing up.</param>
/// <param name="AssistedTranscribers">Of those, the accounts with a transcription or claimed preview.</param>
/// <param name="AssistedPayers">Of those, the accounts with a verified payment.</param>
/// <param name="ConverterTries">30-second previews started from a free tool page's try box in the window.</param>
public sealed record BlogKpisDto(
    int Views,
    int Visitors,
    int NewVisitors,
    int Readers,
    double? ReadRate,
    int CompleteReads,
    double? AvgActiveSeconds,
    int CtaClicks,
    int SignupsFromBlog,
    int TranscribersFromBlog,
    int PayersFromBlog,
    int AssistedSignups,
    int AssistedTranscribers,
    int AssistedPayers,
    int ConverterTries);

/// <param name="Key">Stable id for the step: visitors, readers, cta, app, signup, transcribed, paid.</param>
/// <param name="Approximate">True when the step leans on a join that can miss or over-match (see <paramref name="Join"/>).</param>
/// <param name="Join">How a visitor is tied to this step, in a sentence for the console.</param>
public sealed record BlogFunnelStageDto(string Key, string Label, int Count, bool Approximate, string Join);

/// <summary>One blog, hymn, free tool or comparison page over the window.</summary>
/// <param name="Kind">"post", "hymn", "tool", "compare" or "index".</param>
/// <param name="ConverterTries">30-second previews started from this page's try box (tool and comparison pages).</param>
/// <param name="EntryVisitors">New visitors whose first blog page was this one (first touch).</param>
/// <param name="Signups">First-touch sign-ups credited to this page; likewise transcribers and payers.</param>
public sealed record BlogPostRowDto(
    string Path,
    string Kind,
    int Views,
    int Visitors,
    int Reads,
    int Readers,
    double? ReadRate,
    int CompleteReads,
    double? AvgActiveSeconds,
    int CtaClicks,
    int Shares,
    int HymnPlays,
    int EntryVisitors,
    int Signups,
    int Transcribers,
    int Payers,
    int ConverterTries);

/// <summary>New visitors by where their first blog page came from.</summary>
/// <param name="Source">search, social, direct, internal or other.</param>
public sealed record BlogSourceRowDto(string Source, int Visitors, int Readers, int Signups, int Transcribers);

public sealed record BlogEntryRowDto(string Path, int Visitors, int Signups, int Transcribers, int Payers);

/// <param name="Campaign">"source / medium / campaign" from the first blog page's UTM tags, "—" for a missing part.</param>
public sealed record BlogCampaignRowDto(string Campaign, int Visitors, int Signups);

public sealed record BlogShareRowDto(string Network, int Count);

/// <param name="Signups">Accounts created that day after a blog visit (assisted).</param>
public sealed record BlogDailyDto(DateOnly Date, int Views, int Reads, int Signups);
