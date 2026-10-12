using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Common;

/// <summary>
/// The allowance for whole songs — linked (YouTube, Spotify, Apple Music) or uploaded with the voice
/// isolated — kept apart from the free transcription trial because a song costs the worker far more than
/// a hum: a download, a vocal-isolation pass over several minutes of audio, and a transcription of the
/// result. Pro gets a monthly allowance of full songs; a free account gets one short preview of a linked
/// song, ever, to see what the feature does — and no download of it.
/// </summary>
/// <remarks>
/// Counted from the job rows, like the trial, so the number cannot drift from the ledger it is derived
/// from: a song is charged when it is observed to have finished, never when it was merely requested, so a
/// link YouTube refuses or a song that fails to transcribe costs nothing.
/// </remarks>
public static class SongCredits
{
    /// <summary>Full songs a Pro account may transcribe per calendar month (UTC).</summary>
    public const int ProMonthlyAllowance = 20;

    /// <summary>The most of a song Pro transcribes: six minutes covers nearly every hymn and worship song.</summary>
    public const double ProMaxSeconds = 360;

    /// <summary>Previews a free account gets, ever.</summary>
    public const int FreePreviews = 1;

    /// <summary>How much of the song a free preview covers.</summary>
    public const double FreePreviewSeconds = 60;

    /// <summary>Songs charged to <paramref name="userId"/> in the calendar month containing <paramref name="utcNow"/>.</summary>
    public static Task<int> CountUsedThisMonthAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct = default)
    {
        var monthStart = new DateTime(utcNow.Year, utcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var monthEnd = monthStart.AddMonths(1);

        return db.TranscriptionJobs.CountAsync(
            j => j.UserId == userId
                 && (j.Kind == TranscriptionJobKind.Link || j.Kind == TranscriptionJobKind.Song)
                 && j.SongCreditConsumedAtUtc != null
                 && j.SongCreditConsumedAtUtc >= monthStart
                 && j.SongCreditConsumedAtUtc < monthEnd,
            ct);
    }

    /// <summary>
    /// Previews ever charged to <paramref name="userId"/>, or to <paramref name="deviceFingerprint"/> under
    /// any account, plus the account's own free previews still running — held like a running trial
    /// generation (<see cref="TrialUsage.CountUsedAsync"/>), or two links sent at once would both be the
    /// one free preview.
    /// </summary>
    public static async Task<int> CountPreviewsUsedAsync(
        IApplicationDbContext db, Guid userId, string? deviceFingerprint, DateTime utcNow, CancellationToken ct = default)
    {
        var spent = db.TranscriptionJobs.Where(
            j => j.Kind == TranscriptionJobKind.Link && j.SongCreditConsumedAtUtc != null && !j.WasPro);
        var charged = deviceFingerprint is null
            ? await spent.CountAsync(j => j.UserId == userId, ct)
            : await spent.CountAsync(j => j.UserId == userId || j.DeviceFingerprint == deviceFingerprint, ct);

        var since = utcNow - TrialUsage.RunningFor;
        var running = await db.TranscriptionJobs.CountAsync(
            j => j.UserId == userId
                 && j.Kind == TranscriptionJobKind.Link
                 && !j.WasPro
                 && j.SettledAtUtc == null
                 && j.SongCreditConsumedAtUtc == null
                 && j.CreatedAtUtc >= since,
            ct);

        return charged + running;
    }
}
