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

    /// <summary>Pro songs one account may have running at once.</summary>
    public const int ProMaxSongsInProgress = 3;

    /// <summary>
    /// What the Pro song gate and the "N of 20 songs" count read: songs charged this month plus the
    /// account's songs still running, held like a running trial generation
    /// (<see cref="TrialUsage.CountUsedAsync"/>). Charging only on completion meant a subscriber with one
    /// song left could start several and every one would pass. A song that fails settles uncharged and
    /// frees its place; one the worker lost stops counting after <see cref="TrialUsage.RunningFor"/>.
    /// </summary>
    public static async Task<int> CountHeldThisMonthAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct = default)
        => await CountUsedThisMonthAsync(db, userId, utcNow, ct) + await CountInProgressAsync(db, userId, utcNow, ct);

    /// <summary>
    /// The account's songs (linked or isolated from an upload) submitted within <see cref="TrialUsage.RunningFor"/>
    /// and not yet settled or charged.
    /// </summary>
    public static Task<int> CountInProgressAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct = default)
    {
        var since = utcNow - TrialUsage.RunningFor;
        return db.TranscriptionJobs.CountAsync(
            j => j.UserId == userId
                 && (j.Kind == TranscriptionJobKind.Link || j.Kind == TranscriptionJobKind.Song)
                 && j.WasPro
                 && j.SettledAtUtc == null
                 && j.SongCreditConsumedAtUtc == null
                 && j.CreatedAtUtc >= since,
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
                 && !j.PaidByCredit // a bought song holds a bought transcription, not the preview
                 && j.SettledAtUtc == null
                 && j.SongCreditConsumedAtUtc == null
                 && j.CreatedAtUtc >= since,
            ct);

        return charged + running;
    }
}

/// <summary>The Pro song gate, shared by the link submit and the upload-with-isolation submit.</summary>
internal static class SongGate
{
    /// <summary>
    /// Refuses a Pro song when this month's allowance is spent or held by songs still running, or when
    /// <see cref="SongCredits.ProMaxSongsInProgress"/> are already running. Call under the account's
    /// <see cref="Interfaces.IQuotaGate"/> lease, or parallel submits all see the same count.
    /// </summary>
    public static async Task<Shared.Results.Error?> CheckAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct)
    {
        // The allowance first, counting running songs as the "N of 20" display does, so the refusal names
        // the same number the client has been showing.
        var running = await SongCredits.CountInProgressAsync(db, userId, utcNow, ct);
        var used = await SongCredits.CountUsedThisMonthAsync(db, userId, utcNow, ct) + running;
        if (used >= SongCredits.ProMonthlyAllowance)
            return Errors.BillingErrors.SongCreditsExhausted(SongCredits.ProMonthlyAllowance);

        if (running >= SongCredits.ProMaxSongsInProgress)
            return Errors.BillingErrors.SongsInProgress(SongCredits.ProMaxSongsInProgress);

        return null;
    }
}
