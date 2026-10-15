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
    /// under any account, plus the account's own transcriptions still running.
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
        var spent = db.TranscriptionJobs.Where(j => j.TrialConsumedAtUtc != null);
        var charged = deviceFingerprint is null
            ? await spent.CountAsync(j => j.UserId == userId, ct)
            : await spent.CountAsync(j => j.UserId == userId || j.DeviceFingerprint == deviceFingerprint, ct);

        // A linked song run on a bought transcription holds its place the same way: it is charged to this
        // ledger when it finishes, not to the free preview.
        var since = utcNow - RunningFor;
        var running = await db.TranscriptionJobs.CountAsync(
            j => j.UserId == userId
                 && (j.Kind == TranscriptionJobKind.Upload || j.PaidByCredit)
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
    /// The whole allowance as one account on one handset sees it: the free ones, the bought ones, what is
    /// spent or held, and how many bought ones went on whole songs. One read for the submit gates, the link
    /// lookup and the app's count, so none of them can disagree about what is left.
    /// </summary>
    public static async Task<TrialAllowance> ReadAsync(
        IApplicationDbContext db, Guid userId, string? deviceFingerprint, string? country, DateTime utcNow,
        CancellationToken ct = default)
    {
        var since = utcNow - RunningFor;
        var used = await CountUsedAsync(db, userId, deviceFingerprint, utcNow, ct);
        var bought = await CountBoughtAsync(db, userId, ct);
        var songs = bought == 0
            ? 0
            : await db.TranscriptionJobs.CountAsync(
                j => j.UserId == userId
                     && j.PaidByCredit
                     && (j.TrialConsumedAtUtc != null || (j.SettledAtUtc == null && j.CreatedAtUtc >= since)),
                ct);

        return new TrialAllowance(FreeTier.TrialGenerationsFor(country), bought, used, songs);
    }
}

/// <summary>
/// One account's free-tier allowance: <see cref="Free"/> transcriptions to start, plus one for every
/// transcription bought (a <c>Single</c> plan). Bought ones never expire and are spent exactly like free
/// ones — charged when a transcription finishes, nothing for one that fails.
/// </summary>
/// <param name="Used">Charged or still running, per account and per device (<see cref="TrialUsage.CountUsedAsync"/>).</param>
/// <param name="BoughtSpentOnSongs">
/// Linked songs run on a bought transcription, charged or running. Free transcriptions are spent first by
/// everything else, but only a bought one can pay for a whole linked song, so these come off the bought
/// ones directly.
/// </param>
public sealed record TrialAllowance(int Free, int Bought, int Used, int BoughtSpentOnSongs)
{
    /// <summary>Everything this account may transcribe on the free tier, bought ones included.</summary>
    public int Total => Free + Bought;

    /// <summary>What is left of <see cref="Total"/>, floored at zero.</summary>
    public int Remaining => Math.Max(0, Total - Used);

    /// <summary>
    /// Bought transcriptions not yet spent: the free ones go first, so these are what remains once they are
    /// gone, less any already spent on a whole song. What pays for a whole linked song on a free account.
    /// </summary>
    public int BoughtRemaining => Math.Max(0, Math.Min(Bought - BoughtSpentOnSongs, Remaining));
}
