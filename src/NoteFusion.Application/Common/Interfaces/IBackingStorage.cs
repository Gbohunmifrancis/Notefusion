using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Where a song's backing — the instrumental the worker separated from the voice, a small mono MP3 — is kept with
/// the sheet of a song its owner uploaded, so it plays under the tune next week and offline. Never a pasted link's.
/// The bytes are only ever handed out by the API, to the sheet's owner: the names this store gives are unguessable
/// and stay on the server.
/// </summary>
public interface IBackingStorage
{
    /// <summary>
    /// Stores <paramref name="mp3"/> for <paramref name="userId"/> under a new name, and returns that name to keep on
    /// the sheet. A failure (the store is off or unreachable) means the sheet is filed without a backing.
    /// </summary>
    Task<Result<string>> SaveAsync(Guid userId, byte[] mp3, CancellationToken ct);

    /// <summary>The backing stored under <paramref name="key"/>; NotFound when it is not there (or the store is off).</summary>
    Task<Result<byte[]>> ReadAsync(string key, CancellationToken ct);

    /// <summary>Deletes the backings stored under <paramref name="keys"/>. Best effort: a failure is logged, not thrown.</summary>
    Task DeleteAsync(IReadOnlyCollection<string> keys, CancellationToken ct);

    /// <summary>
    /// Deletes every backing stored for <paramref name="userId"/>, the ones no sheet names any more included (a sheet
    /// whose own delete failed). For a closed account. Best effort, like <see cref="DeleteAsync"/>.
    /// </summary>
    Task DeleteAllForUserAsync(Guid userId, CancellationToken ct);
}
