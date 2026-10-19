namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// The server-side record of every passkey challenge issued and not yet answered. A challenge is taken at
/// most once (a second answer to the same options is refused) and only before it expires.
/// </summary>
/// <remarks>
/// In memory (Infrastructure's <c>InMemoryPasskeyChallengeStore</c>), which assumes the single API instance
/// CLAUDE.md already assumes for the quota gate; scaling out needs a table or a shared cache instead.
/// </remarks>
public interface IPasskeyChallengeStore
{
    void Save(PasskeyChallenge challenge);

    /// <summary>Removes and returns the challenge, or null when it was never issued, already taken, or expired.</summary>
    PasskeyChallenge? Take(string challenge);
}

public enum PasskeyCeremonyKind
{
    Registration = 1,
    SignIn = 2,

    /// <summary>Unlocking the admin console for the admin already signed in (bound to them).</summary>
    Unlock = 3
}

/// <summary>
/// One outstanding challenge: the options it was issued in (the verifier checks the response against
/// exactly those), what it is for, and for a registration, whose account it adds to.
/// </summary>
public sealed record PasskeyChallenge(
    string Challenge,
    PasskeyCeremonyKind Kind,
    Guid? UserId,
    string OptionsJson,
    DateTime ExpiresAtUtc)
{
    /// <summary>How long a browser has to answer a challenge.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(5);
}
