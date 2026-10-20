using System.Text.RegularExpressions;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Sessions;

/// <summary>The Sessions page's rules, apart so they are tested on their own.</summary>
public static partial class SessionRules
{
    /// <summary>A recording whose last piece came within this is a session still going ("Recording now").</summary>
    public static readonly TimeSpan LiveWithin = TimeSpan.FromSeconds(90);

    /// <summary>The most error events read for one recording.</summary>
    public const int MaxErrorsPerRecording = 5;

    public static readonly Error NotConfigured = Error.Failure(
        "SESSIONS_NOT_CONFIGURED",
        "Sessions needs a read-only Sentry token: set SENTRY_API_TOKEN in GitHub's Actions secrets and deploy.");

    public static readonly Error UnknownRecording = Error.NotFound("SESSION_NOT_FOUND", "Sentry has no recording by that id.");

    /// <summary>"Phone", "API", "Worker" or "Web", from the project's Sentry platform.</summary>
    public static string Source(string platform)
    {
        var p = platform.ToLowerInvariant();
        if (p.Contains("react-native") || p.Contains("android") || p.Contains("cocoa") || p.Contains("ios"))
            return "Phone";
        if (p.Contains("csharp") || p.Contains("dotnet") || p.Contains("aspnet"))
            return "API";
        if (p.Contains("python"))
            return "Worker";
        if (p.Contains("javascript") || p.Contains("node"))
            return "Web";
        return platform;
    }

    /// <summary>The platforms a source name filters on (the console's chips).</summary>
    public static bool IsSource(string platform, string source)
        => string.Equals(Source(platform), source, StringComparison.OrdinalIgnoreCase);

    /// <summary>"com.notefusion.com@1.0.1+43" → "43"; a release with no build number is shown whole.</summary>
    public static string? Build(string? release)
    {
        if (string.IsNullOrWhiteSpace(release))
            return null;
        var plus = release.LastIndexOf('+');
        return plus >= 0 && plus < release.Length - 1 ? release[(plus + 1)..] : release;
    }

    public static bool RecordingNow(SentryReplay replay, DateTime now)
        => replay.FinishedAt is { } last && now - last <= LiveWithin;

    /// <summary>Sentry's ids are 32 hex characters; anything else never reaches a URL.</summary>
    public static bool IsSentryId(string? id) => id is not null && SentryId().IsMatch(id);

    /// <summary>A project slug as Sentry writes them.</summary>
    public static bool IsSlug(string? slug) => slug is not null && Slug().IsMatch(slug);

    [GeneratedRegex("^[0-9a-f]{32}$")]
    private static partial Regex SentryId();

    [GeneratedRegex("^[a-z0-9][a-z0-9_-]{0,49}$")]
    private static partial Regex Slug();

    internal static int Offset(DateTime at, DateTime start) => Math.Max(0, (int)(at - start).TotalMilliseconds);

    /// <summary>How far apart Sentry's two notes of one request may land (the span at its start, the log line at its end).</summary>
    public const int SameRequestWithinMs = 2000;

    /// <summary>
    /// Sentry notes each request twice, as a log line and as a network span, so "GET /api/me → 401" came out twice.
    /// Steps in time order: a request with the same method and path as one kept within <see cref="SameRequestWithinMs"/>
    /// is folded into it, keeping the earlier moment and the line that carries the status.
    /// </summary>
    public static IReadOnlyList<SessionStepDto> MergeRequests(IEnumerable<SessionStepDto> steps)
    {
        var kept = new List<SessionStepDto>();
        foreach (var step in steps)
        {
            var index = step.Kind == "request" ? FindSameRequest(kept, step) : -1;
            if (index < 0)
            {
                kept.Add(step);
                continue;
            }
            if (!kept[index].Text.Contains(" → ", StringComparison.Ordinal) && step.Text.Contains(" → ", StringComparison.Ordinal))
                kept[index] = kept[index] with { Text = step.Text };
        }
        return kept;
    }

    private static int FindSameRequest(List<SessionStepDto> kept, SessionStepDto step)
    {
        var key = RequestKey(step.Text);
        for (var i = kept.Count - 1; i >= 0 && step.AtMs - kept[i].AtMs <= SameRequestWithinMs; i--)
            if (kept[i].Kind == "request" && RequestKey(kept[i].Text) == key)
                return i;
        return -1;
    }

    /// <summary>"GET /api/me → 401" → "GET /api/me".</summary>
    private static string RequestKey(string text)
    {
        var arrow = text.IndexOf(" → ", StringComparison.Ordinal);
        return arrow < 0 ? text : text[..arrow];
    }
}

/// <summary><c>GET /api/admin/sessions/recordings</c>: the phone's recordings, newest first, with whose they are.</summary>
public sealed record GetSessionRecordingsQuery(bool WithErrors, string? Cursor) : IRequest<Result<SessionRecordingsPageDto>>;

/// <summary><c>GET /api/admin/sessions/recordings/{id}</c>: one recording with its video pieces, steps and errors.</summary>
public sealed record GetSessionRecordingQuery(string Id) : IRequest<Result<SessionRecordingDetailDto>>;

/// <summary><c>GET /api/admin/sessions/recordings/{id}/videos/{segment}?project=</c>: one MP4 piece.</summary>
public sealed record GetSessionVideoQuery(string Id, string Project, int SegmentId) : IRequest<Result<byte[]>>;

/// <summary><c>GET /api/admin/sessions/errors?source=</c>: every project's unresolved errors, most people first.</summary>
public sealed record GetSessionErrorsQuery(string? Source) : IRequest<Result<IReadOnlyList<SessionIssueDto>>>;

/// <summary><c>GET /api/admin/sessions/errors/{id}/recording</c>: the recording of an error's latest event, if any.</summary>
public sealed record GetSessionErrorRecordingQuery(string IssueId) : IRequest<Result<SessionIssueRecordingDto>>;

public sealed class SessionQueryHandlers :
    IRequestHandler<GetSessionRecordingsQuery, Result<SessionRecordingsPageDto>>,
    IRequestHandler<GetSessionRecordingQuery, Result<SessionRecordingDetailDto>>,
    IRequestHandler<GetSessionVideoQuery, Result<byte[]>>,
    IRequestHandler<GetSessionErrorsQuery, Result<IReadOnlyList<SessionIssueDto>>>,
    IRequestHandler<GetSessionErrorRecordingQuery, Result<SessionIssueRecordingDto>>
{
    private readonly ISentrySessions _sentry;
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public SessionQueryHandlers(ISentrySessions sentry, IApplicationDbContext db, IDateTimeProvider clock)
    {
        _sentry = sentry;
        _db = db;
        _clock = clock;
    }

    public async Task<Result<SessionRecordingsPageDto>> Handle(GetSessionRecordingsQuery request, CancellationToken ct)
    {
        if (!_sentry.IsConfigured)
            return SessionRules.NotConfigured;
        var projects = await _sentry.ProjectsAsync(ct);
        if (projects.IsFailure)
            return projects.Error;
        var page = await _sentry.ReplaysAsync(request.WithErrors, request.Cursor, ct);
        if (page.IsFailure)
            return page.Error;

        var people = await PeopleAsync(page.Value.Items.Select(r => r.UserId), ct);
        var items = page.Value.Items.Select(r => ToDto(r, projects.Value, people)).ToList();
        return new SessionRecordingsPageDto(items, page.Value.NextCursor);
    }

    public async Task<Result<SessionRecordingDetailDto>> Handle(GetSessionRecordingQuery request, CancellationToken ct)
    {
        if (!_sentry.IsConfigured)
            return SessionRules.NotConfigured;
        if (!SessionRules.IsSentryId(request.Id))
            return SessionRules.UnknownRecording;
        var projects = await _sentry.ProjectsAsync(ct);
        if (projects.IsFailure)
            return projects.Error;
        var found = await _sentry.ReplayAsync(request.Id, ct);
        if (found.IsFailure)
            return found.Error;
        if (found.Value is not { } replay)
            return SessionRules.UnknownRecording;

        var dto = ToDto(replay, projects.Value, await PeopleAsync([replay.UserId], ct));
        var recording = await _sentry.RecordingAsync(dto.Project, replay.Id, ct);
        if (recording.IsFailure)
            return recording.Error;

        var start = replay.StartedAt;
        var errors = new List<SessionErrorDto>();
        foreach (var eventId in replay.ErrorIds.Where(SessionRules.IsSentryId).Take(SessionRules.MaxErrorsPerRecording))
        {
            // An error that cannot be read now is left out rather than failing the page: the recording still plays.
            var read = await _sentry.ErrorEventAsync(dto.Project, eventId, ct);
            if (read.IsSuccess && read.Value is { } e)
                errors.Add(new SessionErrorDto(e.Id, SessionRules.Offset(e.At, start), e.Title, e.Frames));
        }

        return new SessionRecordingDetailDto(
            dto,
            recording.Value.Videos
                .OrderBy(v => v.StartsAt)
                .Select(v => new SessionVideoDto(v.SegmentId, SessionRules.Offset(v.StartsAt, start), v.DurationMs))
                .ToList(),
            SessionRules.MergeRequests(recording.Value.Steps
                .OrderBy(s => s.At)
                .Select(s => new SessionStepDto(SessionRules.Offset(s.At, start), s.Kind, s.Text))),
            errors.OrderBy(e => e.AtMs).ToList(),
            $"https://{_sentry.Org}.sentry.io/replays/{replay.Id}/");
    }

    public async Task<Result<byte[]>> Handle(GetSessionVideoQuery request, CancellationToken ct)
    {
        if (!_sentry.IsConfigured)
            return SessionRules.NotConfigured;
        if (!SessionRules.IsSentryId(request.Id) || !SessionRules.IsSlug(request.Project) || request.SegmentId < 0)
            return SessionRules.UnknownRecording;
        var projects = await _sentry.ProjectsAsync(ct);
        if (projects.IsFailure)
            return projects.Error;
        // Only a project of this organisation: the slug goes into Sentry's URL.
        if (!projects.Value.Any(p => p.Slug == request.Project))
            return SessionRules.UnknownRecording;
        return await _sentry.VideoAsync(request.Project, request.Id, request.SegmentId, ct);
    }

    public async Task<Result<IReadOnlyList<SessionIssueDto>>> Handle(GetSessionErrorsQuery request, CancellationToken ct)
    {
        if (!_sentry.IsConfigured)
            return SessionRules.NotConfigured;
        var projects = await _sentry.ProjectsAsync(ct);
        if (projects.IsFailure)
            return projects.Error;

        string? projectId = null;
        if (!string.IsNullOrWhiteSpace(request.Source))
        {
            var match = projects.Value.FirstOrDefault(p => SessionRules.IsSource(p.Platform, request.Source));
            if (match is null)
                return Result.Success<IReadOnlyList<SessionIssueDto>>([]);
            projectId = match.Id;
        }

        var issues = await _sentry.IssuesAsync(projectId, ct);
        if (issues.IsFailure)
            return issues.Error;
        var byId = projects.Value.ToDictionary(p => p.Id);
        return Result.Success<IReadOnlyList<SessionIssueDto>>(issues.Value
            .Select(i => new SessionIssueDto(
                i.Id,
                i.Title,
                i.Culprit,
                byId.TryGetValue(i.ProjectId, out var p) ? SessionRules.Source(p.Platform) : "Other",
                i.Count,
                i.UserCount,
                i.FirstSeen,
                i.LastSeen,
                i.Permalink))
            .ToList());
    }

    public async Task<Result<SessionIssueRecordingDto>> Handle(GetSessionErrorRecordingQuery request, CancellationToken ct)
    {
        if (!_sentry.IsConfigured)
            return SessionRules.NotConfigured;
        if (string.IsNullOrWhiteSpace(request.IssueId) || !request.IssueId.All(char.IsAsciiDigit))
            return Error.NotFound("SESSION_ERROR_NOT_FOUND", "Sentry has no error by that id.");
        var replay = await _sentry.LatestReplayOfIssueAsync(request.IssueId, ct);
        if (replay.IsFailure)
            return replay.Error;
        return new SessionIssueRecordingDto(SessionRules.IsSentryId(replay.Value) ? replay.Value : null);
    }

    private SessionRecordingDto ToDto(
        SentryReplay r, IReadOnlyList<SentryProject> projects, IReadOnlyDictionary<Guid, SessionPersonDto> people)
    {
        var slug = projects.FirstOrDefault(p => p.Id == r.ProjectId)?.Slug ?? string.Empty;
        SessionPersonDto? person = Guid.TryParse(r.UserId, out var id) && people.TryGetValue(id, out var found) ? found : null;
        return new SessionRecordingDto(
            r.Id,
            slug,
            r.StartedAt,
            r.DurationSeconds,
            SessionRules.RecordingNow(r, _clock.UtcNow),
            r.ErrorCount,
            person,
            r.Device,
            r.Os,
            SessionRules.Build(r.Release),
            r.Screens);
    }

    private async Task<IReadOnlyDictionary<Guid, SessionPersonDto>> PeopleAsync(IEnumerable<string?> userIds, CancellationToken ct)
    {
        var ids = userIds.Select(u => Guid.TryParse(u, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).Distinct().ToList();
        if (ids.Count == 0)
            return new Dictionary<Guid, SessionPersonDto>();
        return await _db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .Select(u => new SessionPersonDto(u.Id, u.FullName, u.Email))
            .ToDictionaryAsync(p => p.Id, ct);
    }
}
