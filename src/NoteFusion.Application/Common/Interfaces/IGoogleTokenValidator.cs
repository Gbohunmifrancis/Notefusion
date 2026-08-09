namespace NoteFusion.Application.Common.Interfaces;

/// <summary>Outcome of validating a Google-issued ID token.</summary>
/// <param name="SubjectId">The stable Google <c>sub</c> claim (unique per Google account).</param>
/// <param name="Email">The account email.</param>
/// <param name="EmailVerified">Whether Google has verified the email.</param>
/// <param name="FullName">The display name, if present.</param>
/// <param name="PictureUrl">The Google avatar URL, if present.</param>
public sealed record GoogleIdentity(
    string SubjectId,
    string Email,
    bool EmailVerified,
    string? FullName,
    string? PictureUrl = null);

/// <summary>Validates a Google ID token and extracts the caller's identity.</summary>
public interface IGoogleTokenValidator
{
    /// <summary>Returns the identity when the token is valid; otherwise <c>null</c>.</summary>
    Task<GoogleIdentity?> ValidateAsync(string idToken, CancellationToken cancellationToken = default);
}
