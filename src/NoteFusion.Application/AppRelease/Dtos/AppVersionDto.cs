namespace NoteFusion.Application.AppRelease.Dtos;

/// <summary>
/// What the store carries, as the client sees it. Mirrored by <c>AppVersionInfo</c> in
/// <c>mobile/src/api/types.ts</c>.
/// </summary>
/// <param name="LatestVersion">Newest store version, for display.</param>
/// <param name="LatestBuild">Newest store build. A client below this is offered an update.</param>
/// <param name="MinimumBuild">Oldest supported build. A client below this is blocked.</param>
/// <param name="ReleaseNotes">What changed. May be empty.</param>
/// <param name="AndroidStoreUrl">Play listing.</param>
/// <param name="IosStoreUrl">App Store listing, empty until listed.</param>
public sealed record ActiveAnnouncementDto(string Message, string Severity);

public sealed record AppVersionDto(
    string LatestVersion,
    int LatestBuild,
    int MinimumBuild,
    string ReleaseNotes,
    string AndroidStoreUrl,
    string IosStoreUrl,
    ActiveAnnouncementDto? Announcement = null);

