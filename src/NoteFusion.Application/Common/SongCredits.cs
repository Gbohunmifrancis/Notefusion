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

    /// <summary>
    /// Songs a month a choir shares (<see cref="Core.Entities.Choir"/>): the director and every singer draw on
    /// one pool. A singer with a Pro membership of their own spends their own allowance first and the
    /// choir's after it (<see cref="SongGate"/>).
    /// </summary>
    public const int ChoirMonthlyPool = 60;

    /// <summary>
    /// Songs charged to <paramref name="userId"/>'s own allowance in the calendar month containing
    /// <paramref name="utcNow"/> — not the ones they drew from a choir's pool.
    /// </summary>
    public static Task<int> CountUsedThisMonthAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct = default)
    {
        var (monthStart, monthEnd) = Month(utcNow);

        return db.TranscriptionJobs.CountAsync(
            j => j.UserId == userId
                 && j.ChoirId == null
                 && (j.Kind == TranscriptionJobKind.Link || j.Kind == TranscriptionJobKind.Song)
                 && j.SongCreditConsumedAtUtc != null
                 && j.SongCreditConsumedAtUtc >= monthStart
                 && j.SongCreditConsumedAtUtc < monthEnd,
            ct);
    }

    /// <summary>
    /// What a choir's pool holds this month: songs charged to it plus the ones still running on it, held like
    /// <see cref="CountHeldThisMonthAsync"/> holds an account's own, whoever in the choir submitted them —
    /// including singers who have since left.
    /// </summary>
    public static async Task<int> CountChoirHeldThisMonthAsync(
        IApplicationDbContext db, Guid choirId, DateTime utcNow, CancellationToken ct = default)
    {
        var (monthStart, monthEnd) = Month(utcNow);
        var since = utcNow - TrialUsage.HeldFor;

        var charged = await db.TranscriptionJobs.CountAsync(
            j => j.ChoirId == choirId
                 && j.SongCreditConsumedAtUtc != null
                 && j.SongCreditConsumedAtUtc >= monthStart
                 && j.SongCreditConsumedAtUtc < monthEnd,
            ct);
        var running = await db.TranscriptionJobs.CountAsync(
            j => j.ChoirId == choirId
                 && j.WasPro
                 && j.SettledAtUtc == null
                 && j.SongCreditConsumedAtUtc == null
                 && j.CreatedAtUtc >= since,
            ct);

        return charged + running;
    }

    private static (DateTime Start, DateTime End) Month(DateTime utcNow)
    {
        var monthStart = new DateTime(utcNow.Year, utcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        return (monthStart, monthStart.AddMonths(1));
    }

    /// <summary>Pro songs one account may have running at once.</summary>
    public const int ProMaxSongsInProgress = 3;

    /// <summary>
    /// What the Pro song gate and the "N of 20 songs" count read: songs charged this month plus the
    /// account's songs still running, held like a running trial generation
    /// (<see cref="TrialUsage.CountUsedAsync"/>). Charging only on completion meant a subscriber with one
    /// song left could start several and every one would pass. A song that fails settles uncharged and
    /// frees its place, and so does one the sweep finds lost; one never settled stops counting after
    /// <see cref="TrialUsage.HeldFor"/>.
    /// </summary>
    /// <remarks>The account's own allowance only; a choir's pool is <see cref="CountChoirHeldThisMonthAsync"/>.</remarks>
    public static async Task<int> CountHeldThisMonthAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct = default)
        => await CountUsedThisMonthAsync(db, userId, utcNow, ct) + await CountInProgressAsync(db, userId, utcNow, ownOnly: true, ct);

    /// <summary>
    /// The account's songs (linked or isolated from an upload) submitted within <see cref="TrialUsage.HeldFor"/>
    /// and not yet settled or charged — on any pool, which is what the per-person
    /// <see cref="ProMaxSongsInProgress"/> limit counts.
    /// </summary>
    public static Task<int> CountInProgressAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct = default)
        => CountInProgressAsync(db, userId, utcNow, ownOnly: false, ct);

    private static Task<int> CountInProgressAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, bool ownOnly, CancellationToken ct)
    {
        var since = utcNow - TrialUsage.HeldFor;
        var running = db.TranscriptionJobs.Where(
            j => j.UserId == userId
                 && (j.Kind == TranscriptionJobKind.Link || j.Kind == TranscriptionJobKind.Song)
                 && j.WasPro
                 && j.SettledAtUtc == null
                 && j.SongCreditConsumedAtUtc == null
                 && j.CreatedAtUtc >= since);
        return (ownOnly ? running.Where(j => j.ChoirId == null) : running).CountAsync(ct);
    }

    /// <summary>
    /// Previews ever charged to <paramref name="userId"/> or any account on its inbox, or to
    /// <paramref name="deviceFingerprint"/> under any account, plus the free previews still running on any
    /// of them — held like a running trial generation (<see cref="TrialUsage.CountUsedAsync"/>), or two links
    /// sent at once, or from two accounts on one phone or one inbox, would both be the one free preview.
    /// </summary>
    public static async Task<int> CountPreviewsUsedAsync(
        IApplicationDbContext db, Guid userId, string? deviceFingerprint, DateTime utcNow, CancellationToken ct = default)
    {
        var spent = db.TranscriptionJobs.Where(
            j => j.Kind == TranscriptionJobKind.Link && j.SongCreditConsumedAtUtc != null && !j.WasPro);
        var accounts = await TrialUsage.MailboxAccountsAsync(db, userId, ct);
        var charged = deviceFingerprint is null
            ? await spent.CountAsync(j => accounts.Contains(j.UserId), ct)
            : await spent.CountAsync(j => accounts.Contains(j.UserId) || j.DeviceFingerprint == deviceFingerprint, ct);

        var since = utcNow - TrialUsage.HeldFor;
        var open = db.TranscriptionJobs.Where(
            j => j.Kind == TranscriptionJobKind.Link
                 && !j.WasPro
                 && !j.PaidByCredit // a bought song holds a bought transcription, not the preview
                 && j.SettledAtUtc == null
                 && j.SongCreditConsumedAtUtc == null
                 && j.CreatedAtUtc >= since);
        var running = deviceFingerprint is null
            ? await open.CountAsync(j => accounts.Contains(j.UserId), ct)
            : await open.CountAsync(j => accounts.Contains(j.UserId) || j.DeviceFingerprint == deviceFingerprint, ct);

        return charged + running;
    }
}

/// <summary>The pool a Pro song is charged to: the account's own allowance (null) or a choir's.</summary>
internal sealed record SongPool(Guid? ChoirId);

/// <summary>The Pro song gate, shared by the link submit and the upload-with-isolation submit.</summary>
internal static class SongGate
{
    /// <summary>
    /// Chooses the pool a Pro song draws on — the account's own monthly allowance while it has room, then its
    /// choir's shared pool — and refuses the song when every pool it has is spent or held by songs still
    /// running, or when <see cref="SongCredits.ProMaxSongsInProgress"/> of this person's songs are already
    /// running. Call under the account's <see cref="Interfaces.IQuotaGate"/> lease and, with a choir, the
    /// choir's (<see cref="ProAccess.GateKeys"/>), or parallel submits all see the same count.
    /// </summary>
    public static async Task<Shared.Results.Result<SongPool>> CheckAsync(
        IApplicationDbContext db, ProAccess access, Guid userId, DateTime utcNow, CancellationToken ct)
    {
        // The allowance first, counting running songs as the "N of 20" display does, so the refusal names
        // the same number the client has been showing.
        SongPool? pool = null;
        if (access.OwnPro
            && await SongCredits.CountHeldThisMonthAsync(db, userId, utcNow, ct) < SongCredits.ProMonthlyAllowance)
        {
            pool = new SongPool(null);
        }
        else if (access.ChoirId is { } choirId
                 && await SongCredits.CountChoirHeldThisMonthAsync(db, choirId, utcNow, ct) < SongCredits.ChoirMonthlyPool)
        {
            pool = new SongPool(choirId);
        }

        if (pool is null)
        {
            return access.OwnPro
                ? Errors.BillingErrors.SongCreditsExhausted(access.SongAllowance)
                : Errors.BillingErrors.ChoirSongsExhausted(SongCredits.ChoirMonthlyPool);
        }

        if (await SongCredits.CountInProgressAsync(db, userId, utcNow, ct) >= SongCredits.ProMaxSongsInProgress)
            return Errors.BillingErrors.SongsInProgress(SongCredits.ProMaxSongsInProgress);

        return pool;
    }
}
