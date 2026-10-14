using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Application.Common;

/// <summary>How much one account has transcribed, as the admin console reports it.</summary>
/// <param name="Transcribed">
/// Transcriptions that produced a result, saved or not: the account's finished jobs, the free previews
/// it claimed at sign-up that succeeded, and saved sheets with no job on record (work from before jobs
/// were recorded, on 19 Aug 2026).
/// </param>
/// <param name="Saved">Sheets in the library now; deleting one lowers this, not <paramref name="Transcribed"/>.</param>
/// <param name="Failed">Jobs and claimed previews that ended without a result.</param>
public sealed record UserTranscriptionCounts(int Transcribed, int Saved, int Failed)
{
    public static readonly UserTranscriptionCounts None = new(0, 0, 0);
}

/// <summary>
/// Counts per account for the admin console. Counting saved sheets alone undercounted everyone who
/// transcribes without saving, which is most people trying the app; the jobs are the record of work done.
/// </summary>
public static class TranscriptionCounts
{
    public static async Task<IReadOnlyDictionary<Guid, UserTranscriptionCounts>> ForUsersAsync(
        IApplicationDbContext db, IReadOnlyCollection<Guid> userIds, CancellationToken ct)
    {
        if (userIds.Count == 0)
            return new Dictionary<Guid, UserTranscriptionCounts>();

        var ids = userIds.ToList();

        // Only the facts needed, never the cached result itself: ResultJson is a whole transcription.
        var jobs = await db.TranscriptionJobs.AsNoTracking()
            .Where(j => ids.Contains(j.UserId))
            .Select(j => new { j.UserId, j.JobId, Done = j.ResultJson != null, Settled = j.SettledAtUtc != null })
            .ToListAsync(ct);
        var previews = await db.PreviewJobs.AsNoTracking()
            .Where(p => p.ClaimedByUserId != null && ids.Contains(p.ClaimedByUserId.Value))
            .Select(p => new { UserId = p.ClaimedByUserId!.Value, p.JobId, p.Succeeded, Finished = p.CompletedAtUtc != null })
            .ToListAsync(ct);
        var saved = await db.Transcriptions.AsNoTracking()
            .Where(t => ids.Contains(t.UserId))
            .Select(t => new { t.UserId, t.SourceJobId })
            .ToListAsync(ct);

        var result = new Dictionary<Guid, UserTranscriptionCounts>();
        foreach (var id in ids.Distinct())
        {
            var myJobs = jobs.Where(j => j.UserId == id).ToList();
            var myPreviews = previews.Where(p => p.UserId == id).ToList();
            var mySaved = saved.Where(s => s.UserId == id).ToList();
            var known = myJobs.Select(j => j.JobId).Concat(myPreviews.Select(p => p.JobId)).ToHashSet(StringComparer.Ordinal);

            var transcribed = myJobs.Count(j => j.Done)
                + myPreviews.Count(p => p.Succeeded)
                + mySaved.Count(s => s.SourceJobId is null || !known.Contains(s.SourceJobId));
            var failed = myJobs.Count(j => j.Settled && !j.Done) + myPreviews.Count(p => p.Finished && !p.Succeeded);

            result[id] = new UserTranscriptionCounts(transcribed, mySaved.Count, failed);
        }
        return result;
    }

    /// <summary>
    /// Transcriptions that produced a result in a window, site-wide, by the same rules as
    /// <see cref="ForUsersAsync"/>: finished account jobs, successful free previews (claimed or not), and
    /// saved sheets with no job or preview on record.
    /// </summary>
    public static async Task<int> InWindowAsync(IApplicationDbContext db, DateTime fromUtc, DateTime toUtc, CancellationToken ct)
    {
        // Site-wide figures are customers only (AnalyticsScope); the per-user counts above are not scoped.
        var jobs = await db.RealJobs()
            .CountAsync(j => j.CreatedAtUtc >= fromUtc && j.CreatedAtUtc < toUtc && j.ResultJson != null, ct);
        var previews = await db.RealPreviews()
            .CountAsync(p => p.CreatedAtUtc >= fromUtc && p.CreatedAtUtc < toUtc && p.Succeeded, ct);
        var untracked = await db.RealSheets()
            .CountAsync(t => t.CreatedAtUtc >= fromUtc && t.CreatedAtUtc < toUtc
                && (t.SourceJobId == null
                    || (!db.TranscriptionJobs.Any(j => j.JobId == t.SourceJobId)
                        && !db.PreviewJobs.Any(p => p.JobId == t.SourceJobId))), ct);
        return jobs + previews + untracked;
    }
}
