namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Keeps the register of handsets that spend free generations, and where they are when they do. Called by
/// the submit handler once per accepted submission from a metered account.
/// </summary>
/// <remarks>
/// <para>
/// <b>Stages updates; saves a first sighting.</b> Changes to a known device join the same change tracker
/// as the job they accompany, so the submit handler's <c>SaveChangesAsync</c> commits both. A device seen
/// for the first time is inserted at once, in its own save, so that two accounts registering one handset
/// at the same moment are resolved here (the unique index refuses one; it re-reads the winner) rather
/// than failing the submit. Call it after the worker has accepted the job and <em>before</em> staging the
/// job row, or that save would commit the job early too.
/// </para>
/// <para>
/// This is bookkeeping, not enforcement. The ceiling is counted by <c>TrialUsage.CountUsedAsync</c> from
/// the device stamp on the job rows; nothing here can refuse a request. What it adds is the ability to
/// see the abuse — a device with several accounts on it, or one whose country keeps moving — which is
/// invisible without somewhere to write it down.
/// </para>
/// </remarks>
public interface ITrialDeviceRecorder
{
    /// <summary>
    /// Notes that <paramref name="userId"/> is generating from <paramref name="fingerprint"/>, registering
    /// the device if this is the first time anyone has, and logging the two patterns worth a human's
    /// attention: a device that has now carried more than one account, and a device that has changed
    /// country since it first appeared.
    /// </summary>
    Task RecordAsync(string fingerprint, Guid userId, CancellationToken ct = default);
}
