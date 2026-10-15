using NoteFusion.Core.Enums;
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

    /// <summary>
    /// When the library sweep dealt with this finished job: kept it as a sheet for someone who never
    /// pressed Save, or found it already saved. Null until then. Set once, so a sheet the user deletes
    /// afterwards is not put back.
    /// </summary>
    /// <remarks>
    /// Nine in ten finished transcriptions were never saved, and an unsaved one is gone the moment the
    /// screen closes — nothing in the library to come back to. The sweep waits a while before keeping
    /// it, so the result screen's own choices (which doh, the title, Save itself) still come first.
    /// </remarks>
    public DateTime? AutoSavedAtUtc { get; private set; }

    /// <summary>Upload (a recording), Link (a song fetched from a streaming platform) or Song (an uploaded song the voice is isolated from).</summary>
    public TranscriptionJobKind Kind { get; private set; } = TranscriptionJobKind.Upload;

    /// <summary>
    /// A link or a song upload: the kinds that take a song credit rather than a trial generation. A link a
    /// free account ran on a transcription it bought (<see cref="PaidByCredit"/>) is not one: it is charged
    /// like any other free-tier transcription, against the allowance the purchase raised.
    /// </summary>
    public bool IsSong => (Kind is TranscriptionJobKind.Link or TranscriptionJobKind.Song) && !PaidByCredit;

    /// <summary>
    /// True for a free account's linked song run on a transcription it bought, rather than as the one free
    /// preview. Stamped at submit, like <see cref="WasPro"/>, because it decides which allowance the job
    /// holds while it runs and which one it spends when it finishes: the trial ledger
    /// (<see cref="TrialConsumedAtUtc"/>), never the preview.
    /// </summary>
    public bool PaidByCredit { get; private set; }

    /// <summary>
    /// Whether the submitter was on Pro when a link job was submitted. Stamped up front, unlike the trial
    /// verdict, because the two song allowances are counted separately: a Pro song must never be re-read
    /// as a free preview once the subscription lapses, nor a preview as a Pro song once it starts.
    /// </summary>
    public bool WasPro { get; private set; }

    /// <summary>
    /// When this link or song job took one of the account's song credits (a Pro monthly song, or the free
    /// preview). Null while it is running, if it failed, and always for a plain upload.
    /// </summary>
    public DateTime? SongCreditConsumedAtUtc { get; private set; }

    public static TranscriptionJob Record(string jobId, Guid userId, DateTime utcNow, string? deviceFingerprint = null)
        => new()
        {
            Id = Guid.NewGuid(),
            JobId = Guard.NotNullOrWhiteSpace(jobId),
            UserId = Guard.AgainstEmpty(userId),
            CreatedAtUtc = utcNow,
            DeviceFingerprint = deviceFingerprint
        };

    /// <param name="paidByCredit">
    /// A free account spending a bought transcription on the whole song (see <see cref="PaidByCredit"/>).
    /// Never with <paramref name="wasPro"/>: Pro songs have their own monthly allowance.
    /// </param>
    public static TranscriptionJob RecordLink(
        string jobId, Guid userId, DateTime utcNow, string? deviceFingerprint, bool wasPro, bool paidByCredit = false)
        => new()
        {
            Id = Guid.NewGuid(),
            JobId = Guard.NotNullOrWhiteSpace(jobId),
            UserId = Guard.AgainstEmpty(userId),
            CreatedAtUtc = utcNow,
            DeviceFingerprint = deviceFingerprint,
            Kind = TranscriptionJobKind.Link,
            WasPro = wasPro,
            PaidByCredit = !wasPro && paidByCredit
        };

    /// <summary>
    /// A Pro account's upload of a whole song with instruments: the voice is isolated before transcription,
    /// which is the work a song credit pays for, so it is metered with the links. A free account's song
    /// upload stays a plain upload and spends a trial generation, as it always has.
    /// </summary>
    public static TranscriptionJob RecordSong(string jobId, Guid userId, DateTime utcNow, string? deviceFingerprint)
        => new()
        {
            Id = Guid.NewGuid(),
            JobId = Guard.NotNullOrWhiteSpace(jobId),
            UserId = Guard.AgainstEmpty(userId),
            CreatedAtUtc = utcNow,
            DeviceFingerprint = deviceFingerprint,
            Kind = TranscriptionJobKind.Song,
            WasPro = true
        };

    /// <summary>Records that the library sweep has dealt with this job. Idempotent.</summary>
    public void MarkAutoSaved(DateTime utcNow) => AutoSavedAtUtc ??= utcNow;

    /// <summary>
    /// Charges one song credit to this link or song job. Returns false for a plain upload, and when it
    /// was already charged — a finished job is polled more than once and must cost exactly one song.
    /// </summary>
    public bool ConsumeSongCredit(DateTime utcNow)
    {
        if (!IsSong || SongCreditConsumedAtUtc is not null)
        {
            return false;
        }

        SongCreditConsumedAtUtc = utcNow;
        return true;
    }

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
    /// Resets the trial consumption on this job (support action to restore a user's free quota).
    /// </summary>
    public void ResetTrial()
    {
        TrialConsumedAtUtc = null;
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
