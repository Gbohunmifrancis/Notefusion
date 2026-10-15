using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Common;

/// <summary>
/// How much of the allowance <see cref="FreeTier.TrialGenerationsFor"/> grants is already gone. One query
/// in one place, for the same reason <see cref="FreeTier"/> resolves the ceiling in one method: the submit
/// gate and the count the app displays must never disagree, and two copies of a predicate this fiddly would
/// eventually drift.
/// </summary>
/// <remarks>
/// <para>
/// The allowance is spent per account <em>and</em> per device. Per account alone was avoidable in four
/// taps — sign out, add another Google account, five more free generations — and the device is the only
/// signal that survives that, since both accounts share an address and a country.
/// </para>
/// <para>
/// Counted from the job rows rather than kept in a column, because a derived count cannot drift from the
/// ledger it is derived from. Jobs are stamped with the device at submit and charged at poll, so this
/// counts what a device actually generated, never what an account merely asked for.
/// </para>
/// </remarks>
public static class TrialUsage
{
    /// <summary>
    /// Free generations charged to <paramref name="userId"/>, or to <paramref name="deviceFingerprint"/>
    /// under any account, plus the account's own free transcriptions still running. Transcriptions paid
    /// for with a bought one (<see cref="Core.Entities.TranscriptionJob.PaidByCredit"/>) are not free ones
    /// and are counted per account by <see cref="CountBoughtSpentAsync"/> instead.
    /// </summary>
    /// <param name="deviceFingerprint">
    /// The caller's device, or null when the client sent none. Null falls back to the per-account count —
    /// deliberately open, so an install that predates the device header keeps working while it updates,
    /// rather than being refused a trial it is entitled to.
    /// </param>
    /// <remarks>
    /// A running job is held against the allowance until it settles: it is charged only when it finishes,
    /// so counting finished jobs alone let an account with one left start any number at once and have
    /// every one pass the gate. A job that fails settles uncharged and frees its place; one the worker
    /// lost stops counting after <see cref="RunningFor"/>, when the sweep gives up on it.
    /// </remarks>
    public static async Task<int> CountUsedAsync(
        IApplicationDbContext db, Guid userId, string? deviceFingerprint, DateTime utcNow, CancellationToken ct = default)
    {
        // Successful generations, not saved rows. Counting Transcriptions meant deleting one handed the
        // free slot back, so the limit was avoidable by anyone who noticed.
        var spent = db.TranscriptionJobs.Where(j => j.TrialConsumedAtUtc != null && !j.PaidByCredit);
        var charged = deviceFingerprint is null
            ? await spent.CountAsync(j => j.UserId == userId, ct)
            : await spent.CountAsync(j => j.UserId == userId || j.DeviceFingerprint == deviceFingerprint, ct);

        var since = utcNow - RunningFor;
        var running = await db.TranscriptionJobs.CountAsync(
            j => j.UserId == userId
                 && j.Kind == TranscriptionJobKind.Upload
                 && !j.PaidByCredit
                 && j.SettledAtUtc == null
                 && j.TrialConsumedAtUtc == null
                 && j.CreatedAtUtc >= since,
            ct);

        return charged + running;
    }

    /// <summary>
    /// How long an unsettled job is held against the allowance: the sweep's own give-up age, after which
    /// the job is closed as lost (<c>NotifyTranscriptionReadyCommand.GiveUpAfter</c>).
    /// </summary>
    public static readonly TimeSpan RunningFor = TimeSpan.FromMinutes(30);

    /// <summary>What is left of the allowance, bought transcriptions included, floored at zero.</summary>
    /// <param name="country">The account's country, passed to <see cref="FreeTier.TrialGenerationsFor"/>.</param>
    public static async Task<int> CountRemainingAsync(
        IApplicationDbContext db, Guid userId, string? deviceFingerprint, string? country, DateTime utcNow,
        CancellationToken ct = default)
        => (await ReadAsync(db, userId, deviceFingerprint, country, utcNow, ct)).Remaining;

    /// <summary>
    /// Transcriptions <paramref name="userId"/> has bought, ever: one per fulfilled one-song payment, counted
    /// from the ledger (<see cref="LedgerEntryReason.TranscriptionPurchase"/>) so a payment fulfilled twice
    /// over — a webhook and the sweep — cannot grant two. Per account, not per device: it was paid for.
    /// </summary>
    public static Task<int> CountBoughtAsync(IApplicationDbContext db, Guid userId, CancellationToken ct = default)
        => db.LedgerEntries.CountAsync(
            e => e.UserId == userId
                 && e.Reason == LedgerEntryReason.TranscriptionPurchase
                 && e.Direction == LedgerDirection.Credit,
            ct);

    /// <summary>
    /// Bought transcriptions <paramref name="userId"/> has spent or is holding: its own jobs paid for with
    /// one, charged, or still running within <see cref="RunningFor"/> (a failed one settles uncharged and
    /// gives it back). Per account only, unlike the free count: a purchase is never used up by another
    /// account on the same phone.
    /// </summary>
    public static Task<int> CountBoughtSpentAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct = default)
    {
        var since = utcNow - RunningFor;
        return db.TranscriptionJobs.CountAsync(
            j => j.UserId == userId
                 && j.PaidByCredit
                 && (j.TrialConsumedAtUtc != null || (j.SettledAtUtc == null && j.CreatedAtUtc >= since)),
            ct);
    }

    /// <summary>
    /// The whole allowance as one account on one handset sees it: the free ones (per account and device)
    /// and the bought ones (per account), each with what is spent or held. One read for the submit gates,
    /// the link lookup and the app's count, so none of them can disagree about what is left.
    /// </summary>
    public static async Task<TrialAllowance> ReadAsync(
        IApplicationDbContext db, Guid userId, string? deviceFingerprint, string? country, DateTime utcNow,
        CancellationToken ct = default)
    {
        var used = await CountUsedAsync(db, userId, deviceFingerprint, utcNow, ct);
        var bought = await CountBoughtAsync(db, userId, ct);
        var boughtSpent = bought == 0 ? 0 : await CountBoughtSpentAsync(db, userId, utcNow, ct);

        return new TrialAllowance(FreeTier.TrialGenerationsFor(country), used, bought, boughtSpent);
    }
}

/// <summary>
/// One account's free-tier allowance, in two pools: <see cref="Free"/> transcriptions to start, metered per
/// account and per device as they always were, and one for every transcription bought (a <c>Single</c>
/// plan), metered per account. Bought ones never expire and are spent like free ones — charged when a
/// transcription finishes, nothing for one that fails. The submit spends a free one while any is left
/// and a bought one after that, except that only a bought one pays for a whole linked song.
/// </summary>
/// <param name="FreeUsed">Free ones charged or running (<see cref="TrialUsage.CountUsedAsync"/>).</param>
/// <param name="BoughtUsed">Bought ones charged or running (<see cref="TrialUsage.CountBoughtSpentAsync"/>).</param>
public sealed record TrialAllowance(int Free, int FreeUsed, int Bought, int BoughtUsed)
{
    /// <summary>Everything this account may transcribe on the free tier, bought ones included.</summary>
    public int Total => Free + Bought;

    /// <summary>Free ones left, floored at zero.</summary>
    public int FreeRemaining => Math.Max(0, Free - FreeUsed);

    /// <summary>Bought ones left, floored at zero. What pays for a whole linked song on a free account.</summary>
    public int BoughtRemaining => Math.Max(0, Bought - BoughtUsed);

    /// <summary>What is left of <see cref="Total"/>: both pools.</summary>
    public int Remaining => FreeRemaining + BoughtRemaining;
}
