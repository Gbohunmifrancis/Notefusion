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
    /// When this job took one of the account's free generations. Null while it is still running, if
    /// it failed, or if the submitter was on Pro — none of those cost the user anything.
    /// </summary>
    public DateTime? TrialConsumedAtUtc { get; private set; }

    public static TranscriptionJob Record(string jobId, Guid userId, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            JobId = Guard.NotNullOrWhiteSpace(jobId),
            UserId = Guard.AgainstEmpty(userId),
            CreatedAtUtc = utcNow
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
}
