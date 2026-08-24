using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// Binds one ML job to the account that submitted it, and records whether it spent a free-trial
/// generation. Two things the API cannot otherwise know: who owns a job id (the id is minted by the
/// Python service, which has no concept of accounts), and whether a free account's allowance has
/// actually been used — as opposed to merely requested.
/// </summary>
/// <remarks>
/// A row is written for Pro submissions too. It costs nothing, keeps the ownership check uniform, and
/// means a subscription lapsing does not retroactively turn past Pro work into spent trial uses.
/// </remarks>
public class TranscriptionJob : BaseEntity
{
    private TranscriptionJob() { } // EF Core

    /// <summary>The ML service's job id — the value the client polls with.</summary>
    public string JobId { get; private set; } = string.Empty;

    public Guid UserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>
    /// The handset this job was submitted from — an opaque hash, null for a client that sent none and for
    /// every row written before the free tier became per-device.
    /// </summary>
    /// <remarks>
    /// Stamped at submit rather than when the trial is charged, because charging happens on the poll and
    /// the completion sweep charges with no request in flight at all — there would be no header to read.
    /// This is the column <c>TrialUsage.CountUsedAsync</c> counts, which is what stops a second Google
    /// account on the same phone being five more free generations.
    /// </remarks>
    public string? DeviceFingerprint { get; private set; }

    /// <summary>
    /// When this job took one of the account's free generations. Null while it is still running, if
    /// it failed, or if the submitter was on Pro — none of those cost the user anything.
    /// </summary>
    public DateTime? TrialConsumedAtUtc { get; private set; }

    /// <summary>
    /// The finished transcription, serialised the moment we first observe the ML service report it
    /// done. Null until then, and stays null for a job that failed or was abandoned.
    /// </summary>
    /// <remarks>
    /// Held here because the ML service's job store is in-process memory with a TTL, on a dyno that
    /// cycles daily: by the time someone taps a "ready" notification the source may be gone. Copying
    /// the result onto our own row is what makes that tap reliable.
    /// </remarks>
    public string? ResultJson { get; private set; }

    /// <summary>
    /// When this job reached a terminal state as far as the API is concerned — finished, failed, or
    /// aged out — and therefore owes the user nothing further.
    /// </summary>
    /// <remarks>
    /// Not named for the push, though sending one is its main consequence: a client that polls a job
    /// to completion settles it too, precisely so the sweep does not then push about a result the
    /// user is already looking at. Null means "still open", which is the whole of the sweep predicate.
    /// </remarks>
    public DateTime? SettledAtUtc { get; private set; }

    public static TranscriptionJob Record(string jobId, Guid userId, DateTime utcNow, string? deviceFingerprint = null)
        => new()
        {
            Id = Guid.NewGuid(),
            JobId = Guard.NotNullOrWhiteSpace(jobId),
            UserId = Guard.AgainstEmpty(userId),
            CreatedAtUtc = utcNow,
            DeviceFingerprint = deviceFingerprint
        };

    /// <summary>
    /// Charges one free generation to this job. Returns false when it was already charged, so a
    /// client polling a finished job — which our own client does, several times — cannot spend the
    /// allowance more than once.
    /// </summary>
    public bool ConsumeTrial(DateTime utcNow)
    {
        if (TrialConsumedAtUtc is not null)
        {
            return false;
        }

        TrialConsumedAtUtc = utcNow;
        return true;
    }

    /// <summary>
    /// Closes the job, caching <paramref name="resultJson"/> when there is one. Returns false when it
    /// was already closed, which is the caller's signal that someone else got there first and no push
    /// is owed.
    /// </summary>
    /// <param name="resultJson">
    /// The serialised result for a finished job; null for one that failed or aged out.
    /// </param>
    public bool Settle(string? resultJson, DateTime utcNow)
    {
        if (SettledAtUtc is not null)
        {
            return false;
        }

        ResultJson = resultJson;
        SettledAtUtc = utcNow;
        return true;
    }
}
