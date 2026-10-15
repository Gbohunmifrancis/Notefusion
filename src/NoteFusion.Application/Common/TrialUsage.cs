using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Core.ValueObjects;

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
/// And per inbox: every account whose address delivers to the same mailbox (<see cref="MailboxAccountsAsync"/>)
/// shares one free pool, since <c>you+1@gmail.com</c> and a private window was otherwise a fresh three.
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
    /// Free generations charged to <paramref name="userId"/> or any account on its inbox
    /// (<see cref="MailboxAccountsAsync"/>), or to <paramref name="deviceFingerprint"/> under any account,
    /// plus the free transcriptions still running on any of them. One predicate, so a job that matches two
    /// ways (the same alias on the same phone) is counted once. Transcriptions paid
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
    /// every one pass the gate. A job that fails settles uncharged and frees its place, and so does one the
    /// sweep finds lost; one never settled at all stops counting after <see cref="HeldFor"/>. Held on the
    /// handset as well as the account, like the charged ones: otherwise a second account on the phone could
    /// start while the first one's last free transcription was still running.
    /// </remarks>
    public static async Task<int> CountUsedAsync(
        IApplicationDbContext db, Guid userId, string? deviceFingerprint, DateTime utcNow, CancellationToken ct = default)
    {
        // Successful generations, not saved rows. Counting Transcriptions meant deleting one handed the
        // free slot back, so the limit was avoidable by anyone who noticed.
        var spent = db.TranscriptionJobs.Where(j => j.TrialConsumedAtUtc != null && !j.PaidByCredit);
        var accounts = await MailboxAccountsAsync(db, userId, ct);
        var charged = deviceFingerprint is null
            ? await spent.CountAsync(j => accounts.Contains(j.UserId), ct)
            : await spent.CountAsync(j => accounts.Contains(j.UserId) || j.DeviceFingerprint == deviceFingerprint, ct);

        var since = utcNow - HeldFor;
        var open = db.TranscriptionJobs.Where(
            j => j.Kind == TranscriptionJobKind.Upload
                 && !j.PaidByCredit
                 && j.SettledAtUtc == null
                 && j.TrialConsumedAtUtc == null
                 && j.CreatedAtUtc >= since);
        var running = deviceFingerprint is null
            ? await open.CountAsync(j => accounts.Contains(j.UserId), ct)
            : await open.CountAsync(j => accounts.Contains(j.UserId) || j.DeviceFingerprint == deviceFingerprint, ct);

        return charged + running;
    }

    /// <summary>
    /// The inbox <paramref name="userId"/>'s address delivers to (<see cref="Mailbox.Canonical"/>), or null
    /// for an account that does not exist. Worked out from the address rather than read from the column,
    /// so a row the startup backfill has not reached yet still finds the accounts that have one.
    /// </summary>
    public static async Task<string?> MailboxOfAsync(IApplicationDbContext db, Guid userId, CancellationToken ct = default)
    {
        var email = await db.Users.Where(u => u.Id == userId).Select(u => u.Email).FirstOrDefaultAsync(ct);
        return email is null ? null : Mailbox.Canonical(email);
    }

    /// <summary>
    /// <paramref name="userId"/> and every other account on the same inbox (<see cref="Core.Entities.User.CanonicalEmail"/>):
    /// the accounts whose free transcriptions are one pool, the way every account on a handset shares one.
    /// <c>you+2@gmail.com</c> passes verification through the same inbox as <c>you@gmail.com</c>, so a new
    /// alias is not a new allowance. Always holds <paramref name="userId"/> itself.
    /// </summary>
    public static async Task<List<Guid>> MailboxAccountsAsync(IApplicationDbContext db, Guid userId, CancellationToken ct = default)
    {
        var mailbox = await MailboxOfAsync(db, userId, ct);
        if (mailbox is null)
            return [userId];

        var ids = await db.Users
            .Where(u => u.Id != userId && u.CanonicalEmail == mailbox)
            .Select(u => u.Id)
            .ToListAsync(ct);
        ids.Add(userId);
        return ids;
    }

    /// <summary>
    /// How long a job may go without an answer from the worker before the sweep closes it as lost
    /// (<c>NotifyTranscriptionReadyCommand.GiveUpAfter</c>). Not how long a job is held: one the worker says
    /// is still queued or running is waited for, and held, up to <see cref="HeldFor"/>.
    /// </summary>
    public static readonly TimeSpan RunningFor = TimeSpan.FromMinutes(30);

    /// <summary>
    /// The longest an unsettled job holds its place in an allowance, and the longest the sweep waits for one
    /// the worker still reports as queued or running (<c>NotifyTranscriptionReadyCommand.GiveUpOnRunningAfter</c>).
    /// Hours, not minutes: the worker runs one job at a time and queues up to fifty, so on a busy evening a
    /// normal-lane job waits well past half an hour. Holding it for only that long let the account start
    /// another, and both were charged when they finished. A job the worker has lost is settled by the sweep
    /// long before this (at once on a 404, after <see cref="RunningFor"/> without an answer).
    /// </summary>
    public static readonly TimeSpan HeldFor = TimeSpan.FromHours(4);

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
    /// one, charged, or still running within <see cref="HeldFor"/> (a failed one settles uncharged and
    /// gives it back). Per account only, unlike the free count: a purchase is never used up by another
    /// account on the same phone.
    /// </summary>
    public static Task<int> CountBoughtSpentAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct = default)
    {
        var since = utcNow - HeldFor;
        return db.TranscriptionJobs.CountAsync(
            j => j.UserId == userId
                 && j.PaidByCredit
                 && (j.TrialConsumedAtUtc != null || (j.SettledAtUtc == null && j.CreatedAtUtc >= since)),
            ct);
    }

    /// <summary>
    /// The whole allowance as one account on one handset sees it: the free ones (per account, inbox and device)
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
/// account, per inbox and per device, and one for every transcription bought (a <c>Single</c>
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
