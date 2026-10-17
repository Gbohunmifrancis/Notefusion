using System.Collections.Concurrent;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Security.Passkeys;

/// <summary>
/// <see cref="IPasskeyChallengeStore"/> in process memory. A dictionary rather than IMemoryCache because
/// "taken once" has to be atomic: <c>TryRemove</c> hands a challenge to exactly one of two racing answers.
/// One per process (singleton), which assumes the single API instance the quota gate assumes.
/// </summary>
public sealed class InMemoryPasskeyChallengeStore : IPasskeyChallengeStore
{
    /// <summary>
    /// A ceiling on outstanding challenges, so an anonymous caller asking for sign-in options in a loop (each
    /// rate limited per address) cannot grow this without bound. Far above any real use.
    /// </summary>
    internal const int Capacity = 10_000;

    private readonly ConcurrentDictionary<string, PasskeyChallenge> _challenges = new(StringComparer.Ordinal);
    private readonly IDateTimeProvider _clock;

    public InMemoryPasskeyChallengeStore(IDateTimeProvider clock) => _clock = clock;

    public void Save(PasskeyChallenge challenge)
    {
        if (_challenges.Count >= Capacity)
            Sweep();

        // Still full of live challenges: drop the oldest rather than refuse, so a flood delays nobody's
        // sign-in by more than a retry.
        if (_challenges.Count >= Capacity)
        {
            foreach (var oldest in _challenges.Values.OrderBy(c => c.ExpiresAtUtc).Take(_challenges.Count - Capacity + 1))
                _challenges.TryRemove(oldest.Challenge, out _);
        }

        _challenges[challenge.Challenge] = challenge;
    }

    public PasskeyChallenge? Take(string challenge)
    {
        if (string.IsNullOrEmpty(challenge) || !_challenges.TryRemove(challenge, out var entry))
            return null;

        return entry.ExpiresAtUtc > _clock.UtcNow ? entry : null;
    }

    private void Sweep()
    {
        var now = _clock.UtcNow;
        foreach (var (key, entry) in _challenges)
        {
            if (entry.ExpiresAtUtc <= now)
                _challenges.TryRemove(key, out _);
        }
    }
}
