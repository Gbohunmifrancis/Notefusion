using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// The email provider's sending quota, read from the sends recorded so far (<see cref="EmailBudget"/> holds the
/// rules). The sender asks before every optional email and records every email the provider accepts; a batch of
/// optional mail asks before claiming each item and stops for the run when the answer is no, so what it held is
/// still due next time. Essential mail never asks.
/// </summary>
public interface IEmailQuota
{
    /// <summary>
    /// Whether an optional email of <paramref name="kind"/> may go now. Logs one line when it may not (the kind,
    /// the window, its count and limit). When the count cannot be read, the answer is no.
    /// </summary>
    Task<bool> AllowsOptionalAsync(EmailKind kind, CancellationToken ct);

    /// <summary>Records one email the provider accepted. Never throws, and is not cancelled: the email went.</summary>
    Task RecordSentAsync(EmailKind kind);

    /// <summary>What each capped window has sent against its limit (the System Health card).</summary>
    Task<IReadOnlyList<EmailWindowUsage>> ReadUsageAsync(CancellationToken ct);
}
