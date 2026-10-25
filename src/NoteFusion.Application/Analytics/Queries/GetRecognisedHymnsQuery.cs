using System.Text.Json;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// The console's Hymns recognised page for a window (default the last 30 days). See <see cref="RecognisedHymnsDto"/>.
/// </summary>
/// <param name="From">Inclusive start date (WAT). Null means <paramref name="To"/> minus 30 days.</param>
/// <param name="To">Inclusive end date (WAT). Null means now.</param>
/// <param name="IncludeInternal">Count admins' and internal accounts' takes too (the team's own tests); off by default,
/// as everywhere else in the console.</param>
public sealed record GetRecognisedHymnsQuery(DateTime? From = null, DateTime? To = null, bool IncludeInternal = false)
    : IRequest<Result<RecognisedHymnsDto>>;

/// <remarks>
/// The match is read off each job's cached result (<c>ResultJson</c>, camelCase with nulls written out, so an offer is the
/// one place an object follows <c>"hymnMatch":</c>), as the overview's count is; only that object is parsed. Folded in
/// memory, as the console's other analytics are, so it reads the same on Npgsql and on the tests' SQLite.
/// </remarks>
public sealed class GetRecognisedHymnsQueryHandler : IRequestHandler<GetRecognisedHymnsQuery, Result<RecognisedHymnsDto>>
{
    private const int DefaultWindowDays = 30;

    /// <summary>The newest recognitions listed one by one.</summary>
    public const int RecentLimit = 50;

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetRecognisedHymnsQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    private sealed record Match(string JobId, Guid UserId, DateTime At, string Slug, string Title, string Kind, string Url, double Confidence);

    public async Task<Result<RecognisedHymnsDto>> Handle(GetRecognisedHymnsQuery request, CancellationToken ct)
    {
        var rangeResult = AnalyticsRange.Create(request.From, request.To, DefaultWindowDays, _clock.UtcNow);
        if (rangeResult.IsFailure)
            return rangeResult.Error;
        var range = rangeResult.Value;

        var jobs = (request.IncludeInternal ? _db.TranscriptionJobs : _db.RealJobs()).AsNoTracking()
            .Where(j => j.CreatedAtUtc >= range.FromUtc && j.CreatedAtUtc < range.ToUtc && j.ResultJson != null);
        var finished = await jobs.CountAsync(ct);
        var offered = await jobs
            .Where(j => j.ResultJson!.Contains("\"hymnMatch\":{"))
            .Select(j => new { j.JobId, j.UserId, j.CreatedAtUtc, j.ResultJson })
            .ToListAsync(ct);

        var matches = offered
            .Select(j => Read(j.JobId, j.UserId, j.CreatedAtUtc, j.ResultJson!))
            .OfType<Match>()
            .ToList();

        // Kept: the job's own sheet saved as the hymnbook version of the hymn it matched.
        var jobIds = matches.Select(m => m.JobId).ToList();
        var keptRows = jobIds.Count == 0
            ? []
            : await _db.Transcriptions.AsNoTracking()
                .Where(t => t.SourceJobId != null && jobIds.Contains(t.SourceJobId) && t.HymnSlug != null)
                .Select(t => new { JobId = t.SourceJobId!, Slug = t.HymnSlug! })
                .ToListAsync(ct);
        var kept = keptRows.Select(k => (k.JobId, k.Slug)).ToHashSet();
        bool IsKept(Match m) => kept.Contains((m.JobId, m.Slug));

        var hymns = matches
            .GroupBy(m => m.Slug)
            .Select(g =>
            {
                var newest = g.MaxBy(m => m.At)!;
                return new RecognisedHymnRowDto(g.Key, newest.Title, newest.Kind, newest.Url, g.Count(),
                    g.Select(m => m.UserId).Distinct().Count(), g.Count(IsKept), newest.At);
            })
            .OrderByDescending(r => r.Times)
            .ThenByDescending(r => r.LastAtUtc)
            .ToList();

        var recent = matches.OrderByDescending(m => m.At).Take(RecentLimit).ToList();
        var recentUsers = recent.Select(m => m.UserId).Distinct().ToList();
        var emails = recentUsers.Count == 0
            ? new Dictionary<Guid, string>()
            : await _db.Users.AsNoTracking()
                .Where(u => recentUsers.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id, u => u.Email, ct);

        return new RecognisedHymnsDto(
            range.FromUtc,
            range.ToUtc,
            request.IncludeInternal,
            finished,
            matches.Count,
            matches.Select(m => m.UserId).Distinct().Count(),
            matches.Count(IsKept),
            hymns,
            recent.Select(m => new HymnRecognitionDto(m.At, m.Slug, m.Title, m.Kind, m.Confidence, m.UserId,
                emails.GetValueOrDefault(m.UserId, ""), IsKept(m))).ToList());
    }

    /// <summary>The job's <c>hymnMatch</c>, or null when the cached result cannot be read or names no hymn.</summary>
    private static Match? Read(string jobId, Guid userId, DateTime at, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("hymnMatch", out var hymn) || hymn.ValueKind != JsonValueKind.Object)
                return null;
            var slug = Text(hymn, "slug");
            if (string.IsNullOrWhiteSpace(slug))
                return null;
            var title = Text(hymn, "title");
            var confidence = hymn.TryGetProperty("confidence", out var c) && c.ValueKind == JsonValueKind.Number ? c.GetDouble() : 0;
            return new Match(jobId, userId, at, slug, string.IsNullOrWhiteSpace(title) ? slug : title,
                Text(hymn, "kind") is { Length: > 0 } kind ? kind : "score", Text(hymn, "url"), confidence);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string Text(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
}
