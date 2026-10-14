using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Application.Auth.Services;

/// <summary>
/// A password check against nothing, for the paths where there is no real hash to check against — an
/// unknown address, an account with no password. Without it those paths answer in microseconds while a
/// real account costs a full bcrypt verify, and the difference is a reliable "is this address registered?".
/// </summary>
public static class DummyPasswordCheck
{
    private static readonly object Gate = new();
    private static string? _hash;

    /// <summary>Spends one verify's worth of work and always answers false.</summary>
    public static bool Verify(IPasswordHasher hasher, string password)
    {
        // Hashed once, with the same hasher and so the same work factor as a real account's hash.
        if (_hash is null)
        {
            lock (Gate)
                _hash ??= hasher.Hash(Guid.NewGuid().ToString("N"));
        }

        hasher.Verify(password, _hash);
        return false;
    }
}
