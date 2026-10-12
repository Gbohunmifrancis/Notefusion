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

        var since = utcNow - RunningFor;
        var running = await db.TranscriptionJobs.CountAsync(
            j => j.UserId == userId
                 && j.Kind == TranscriptionJobKind.Upload
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

    /// <summary>What is left of the allowance, floored at zero.</summary>
    /// <param name="country">The account's country, passed to <see cref="FreeTier.TrialGenerationsFor"/>.</param>
    public static async Task<int> CountRemainingAsync(
        IApplicationDbContext db, Guid userId, string? deviceFingerprint, string? country, DateTime utcNow,
        CancellationToken ct = default)
        => Math.Max(
            0,
            FreeTier.TrialGenerationsFor(country) - await CountUsedAsync(db, userId, deviceFingerprint, utcNow, ct));
}
