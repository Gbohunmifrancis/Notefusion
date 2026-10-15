namespace NoteFusion.Core.Enums;

/// <summary>
/// Where one outreach send stands. <see cref="Pending"/> is the claim: written before the provider is
/// called, so a crash mid-send leaves a row that is never sent again rather than one sent twice.
/// </summary>
public enum OutreachStatus
{
    Pending = 0,
    Sent = 1,
    Failed = 2
}
