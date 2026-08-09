using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Tests.Support;

/// <summary>
/// An in-test <see cref="IGoogleTokenValidator"/> that maps token strings to identities the test
/// chose up front. Real validation needs Google's live signing keys, so the boundary is stubbed
/// and the tests cover what the handlers do with the outcome — link, create, or refuse.
/// </summary>
public sealed class StubGoogleTokenValidator : IGoogleTokenValidator
{
    private readonly Dictionary<string, GoogleIdentity> _identities = new(StringComparer.Ordinal);

    /// <summary>Registers a token that validates to the given identity. Unregistered tokens fail.</summary>
    public StubGoogleTokenValidator Accept(
        string idToken,
        string subjectId,
        string email,
        bool emailVerified = true,
        string? fullName = "Google User",
        string? pictureUrl = null)
    {
        _identities[idToken] = new GoogleIdentity(subjectId, email, emailVerified, fullName, pictureUrl);
        return this;
    }

    public Task<GoogleIdentity?> ValidateAsync(string idToken, CancellationToken cancellationToken = default)
        => Task.FromResult(_identities.TryGetValue(idToken, out var identity) ? identity : null);
}
