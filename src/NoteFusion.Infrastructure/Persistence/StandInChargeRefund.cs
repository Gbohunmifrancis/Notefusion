using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Core.Enums;

namespace NoteFusion.Infrastructure.Persistence;

/// <summary>
/// Hands back what link jobs were charged for the store's 30-second preview that stood in when YouTube refused their
/// song, before such a job became free (<see cref="JobCharge.StoodIn"/>): a bought transcription, a free account's one
/// link preview, a Pro song credit. Run at startup, after migrations; a no-op once none is left.
/// </summary>
public static class StandInChargeRefund
{
    /// <summary>Returns how many jobs were handed back.</summary>
    public static async Task<int> RunAsync(ApplicationDbContext db, CancellationToken ct = default)
    {
        // The cached result is camel-case JSON (TranscriptionResultCache); its source says "preview":true only for a
        // stand-in, and each candidate is read back to be sure.
        var charged = await db.TranscriptionJobs
            .Where(j => j.Kind == TranscriptionJobKind.Link
                        && (j.SongCreditConsumedAtUtc != null || j.TrialConsumedAtUtc != null)
                        && j.ResultJson != null && j.ResultJson.Contains("\"preview\":true"))
            .ToListAsync(ct);

        var refunded = 0;
        foreach (var job in charged)
        {
            var result = TranscriptionResultCache.Deserialize(job.ResultJson!);
            if (result is not null && JobCharge.StoodIn(result) && job.Uncharge())
                refunded++;
        }
        if (refunded > 0)
            await db.SaveChangesAsync(ct);
        return refunded;
    }
}
