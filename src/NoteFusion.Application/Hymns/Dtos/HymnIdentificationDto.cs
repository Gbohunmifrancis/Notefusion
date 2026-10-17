namespace NoteFusion.Application.Hymns.Dtos;

/// <summary>
/// What "Hum to find a hymn" heard: the hymn, when the worker's matcher is sure of one; how many notes it
/// heard; and whether that was too few to name any hymn (then <see cref="Match"/> is always null).
/// </summary>
public sealed record HymnIdentificationDto(IdentifiedHymnDto? Match, int NotesHeard, bool TooShort, double SecondsHeard);

/// <param name="Url">The hymn's page (absolute); for an incipit, wherever its source lives.</param>
/// <param name="Kind">"hymn" (a hymn page), "tune" (a tune page, no words) or "incipit" (recognition only).</param>
/// <param name="FirstLine">The opening words of the first verse; null for a tune without words.</param>
public sealed record IdentifiedHymnDto(
    string Slug, string Title, string Tune, string Url, string Kind, double Confidence, string? FirstLine);
