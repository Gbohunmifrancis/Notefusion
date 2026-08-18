using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Hosting for user-supplied images (today: avatars only). The API proxies the upload rather than
/// handing the client a signed upload token, so no storage credential ever ships inside the app
/// binary — the same reason the transcriber is only reachable through this backend.
/// </summary>
public interface IImageStorage
{
    /// <summary>
    /// Stores <paramref name="content"/> as the user's avatar and returns the public URL to persist.
    /// One deterministic destination per user, so replacing a picture overwrites the previous file
    /// instead of accumulating orphans no one can reach.
    /// </summary>
    Task<Result<string>> UploadAvatarAsync(Stream content, string fileName, Guid userId, CancellationToken ct);

    /// <summary>
    /// Removes the user's stored avatar. Keyed on the user, not on the URL, because the URL may be
    /// Google's (adopted at sign-in by <c>SetProfilePictureIfMissing</c>) and is not ours to delete.
    /// Best-effort by contract: the caller has already cleared the record, and a stranded file is a
    /// cleanup problem rather than a reason to fail the user's request.
    /// </summary>
    Task DeleteAvatarAsync(Guid userId, CancellationToken ct);
}
