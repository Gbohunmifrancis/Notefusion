namespace NoteFusion.Application.Admin.Sessions;

/// <summary>Who a recording belongs to, looked up in our own accounts from the id the app gave Sentry.</summary>
public sealed record SessionPersonDto(Guid Id, string Name, string Email);

/// <param name="Project">The Sentry project's slug, which the player hands back to fetch the video.</param>
/// <param name="RecordingNow">A piece arrived in the last <see cref="SessionRules.LiveWithin"/>: the session is still going.</param>
/// <param name="Build">"43" from the release "com.notefusion.com@1.0.1+43".</param>
public sealed record SessionRecordingDto(
    string Id,
    string Project,
    DateTime StartedAt,
    int DurationSeconds,
    bool RecordingNow,
    int ErrorCount,
    SessionPersonDto? Person,
    string? Device,
    string? Os,
    string? Build,
    IReadOnlyList<string> Screens);

public sealed record SessionRecordingsPageDto(IReadOnlyList<SessionRecordingDto> Items, string? NextCursor);

/// <summary>A video piece, placed on the recording's own clock.</summary>
public sealed record SessionVideoDto(int SegmentId, int StartMs, int DurationMs);

public sealed record SessionStepDto(int AtMs, string Kind, string Text);

public sealed record SessionErrorDto(string Id, int AtMs, string Title, IReadOnlyList<string> Frames);

public sealed record SessionRecordingDetailDto(
    SessionRecordingDto Recording,
    IReadOnlyList<SessionVideoDto> Videos,
    IReadOnlyList<SessionStepDto> Steps,
    IReadOnlyList<SessionErrorDto> Errors,
    string SentryUrl);

/// <param name="Source">"Phone", "API", "Worker" or "Web", from the Sentry project's platform.</param>
/// <param name="Where">The code it happened in (Sentry's culprit).</param>
public sealed record SessionIssueDto(
    string Id,
    string Title,
    string Where,
    string Source,
    int Count,
    int People,
    DateTime FirstSeen,
    DateTime LastSeen,
    string SentryUrl);

/// <summary>An error's latest recording, or nothing when its latest event was not recorded.</summary>
public sealed record SessionIssueRecordingDto(string? RecordingId);
