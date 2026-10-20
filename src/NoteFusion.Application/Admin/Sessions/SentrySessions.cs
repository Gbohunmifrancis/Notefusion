using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Sessions;

/// <summary>
/// Sentry read for the console's Sessions page (board k-sessions): the phone's session recordings and every project's
/// errors, through a read-only token (<c>SentryApi__Token</c>, an internal integration with read access to Organization,
/// Project and Issue &amp; Event). Nothing is written to Sentry or kept here.
/// </summary>
public interface ISentrySessions
{
    /// <summary>False until <c>SentryApi__Token</c> and <c>SentryApi__Org</c> are set: the page says how to connect it.</summary>
    bool IsConfigured { get; }

    /// <summary>The organisation's slug, for links to Sentry's own pages.</summary>
    string Org { get; }

    Task<Result<IReadOnlyList<SentryProject>>> ProjectsAsync(CancellationToken ct);

    /// <summary>Recordings of the last 14 days, newest first, 25 a page; <paramref name="withErrors"/> keeps those that hit one.</summary>
    Task<Result<SentryReplayPage>> ReplaysAsync(bool withErrors, string? cursor, CancellationToken ct);

    /// <summary>One recording, or null when Sentry has none by that id.</summary>
    Task<Result<SentryReplay?>> ReplayAsync(string replayId, CancellationToken ct);

    /// <summary>The recording's video pieces and what happened in it, in order.</summary>
    Task<Result<SentryRecording>> RecordingAsync(string projectSlug, string replayId, CancellationToken ct);

    /// <summary>One video piece (MP4) of a phone recording.</summary>
    Task<Result<byte[]>> VideoAsync(string projectSlug, string replayId, int segmentId, CancellationToken ct);

    /// <summary>An error event with its readable stack, or null when it is gone.</summary>
    Task<Result<SentryErrorEvent?>> ErrorEventAsync(string projectSlug, string eventId, CancellationToken ct);

    /// <summary>Unresolved errors of the last 7 days, the most people affected first; <paramref name="projectId"/> keeps one project's.</summary>
    Task<Result<IReadOnlyList<SentryIssue>>> IssuesAsync(string? projectId, CancellationToken ct);

    /// <summary>The recording of an error's latest event, or null when that event has none.</summary>
    Task<Result<string?>> LatestReplayOfIssueAsync(string issueId, CancellationToken ct);
}

public sealed record SentryProject(string Id, string Slug, string Platform);

public sealed record SentryReplayPage(IReadOnlyList<SentryReplay> Items, string? NextCursor);

/// <param name="UserId">What the app set as the Sentry user: the account's id, nothing else.</param>
/// <param name="Release">"com.notefusion.com@1.0.1+43".</param>
/// <param name="Screens">The screens it went through, in order (Sentry's <c>urls</c> for a phone recording).</param>
public sealed record SentryReplay(
    string Id,
    string ProjectId,
    DateTime StartedAt,
    DateTime? FinishedAt,
    int DurationSeconds,
    int ErrorCount,
    string? UserId,
    string? Device,
    string? Os,
    string? Release,
    IReadOnlyList<string> Screens,
    IReadOnlyList<string> ErrorIds);

public sealed record SentryRecording(IReadOnlyList<SentryVideoPiece> Videos, IReadOnlyList<SentryStep> Steps);

public sealed record SentryVideoPiece(int SegmentId, DateTime StartsAt, int DurationMs);

/// <param name="Kind">"screen", "tap", "request", "app" or "note".</param>
public sealed record SentryStep(DateTime At, string Kind, string Text);

/// <param name="Frames">The stack's own frames, innermost first, "at fn (file:line)".</param>
public sealed record SentryErrorEvent(string Id, DateTime At, string Title, IReadOnlyList<string> Frames);

public sealed record SentryIssue(
    string Id,
    string Title,
    string Culprit,
    string ProjectId,
    int Count,
    int UserCount,
    DateTime FirstSeen,
    DateTime LastSeen,
    string Permalink);
