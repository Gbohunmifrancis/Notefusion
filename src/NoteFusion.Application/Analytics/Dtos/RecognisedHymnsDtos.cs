namespace NoteFusion.Application.Analytics.Dtos;

/// <summary>
/// The console's Hymns recognised page: which hymns people's takes matched in the window (the worker's <c>hymnMatch</c>
/// on each finished job), how often, by how many accounts, and how many were kept as the hymnbook version (a sheet saved
/// with that job's <c>hymnSlug</c>). <c>Finished</c> is every job in the window with a result, the base for the rate.
/// </summary>
public sealed record RecognisedHymnsDto(
    DateTime FromUtc,
    DateTime ToUtc,
    bool IncludesInternal,
    int Finished,
    int Recognised,
    int Accounts,
    int Kept,
    IReadOnlyList<RecognisedHymnRowDto> Hymns,
    IReadOnlyList<HymnRecognitionDto> Recent);

/// <summary>One hymn: <c>Kind</c> "score" (its hymnbook version was offered) or "incipit" (named and linked only).</summary>
public sealed record RecognisedHymnRowDto(
    string Slug,
    string Title,
    string Kind,
    string Url,
    int Times,
    int Accounts,
    int Kept,
    DateTime LastAtUtc);

/// <summary>One take that matched a hymn, newest first.</summary>
public sealed record HymnRecognitionDto(
    DateTime AtUtc,
    string Slug,
    string Title,
    string Kind,
    double Confidence,
    Guid UserId,
    string Email,
    bool Kept);
