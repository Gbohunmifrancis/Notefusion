using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using NoteFusion.Application.Admin.PhoneLock;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Security;

/// <summary>
/// The phone admin lock's codes, failed tries and passes, in memory (<see cref="IAdminPhoneLock"/>). Passes are kept
/// by the SHA-256 of their token, so a memory dump hands out no pass. One API instance, like the passkey challenges.
/// </summary>
public sealed class InMemoryAdminPhoneLock : IAdminPhoneLock
{
    private sealed record Code(Guid UserId, string Purpose, string Value, DateTime ExpiresAtUtc);

    private readonly ConcurrentDictionary<string, Code> _codes = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<Guid, List<DateTime>> _issued = new();
    private readonly ConcurrentDictionary<Guid, List<DateTime>> _failures = new();
    private readonly ConcurrentDictionary<Guid, DateTime> _lockedUntil = new();
    private readonly ConcurrentDictionary<string, AdminPhoneSession> _sessions = new(StringComparer.Ordinal);

    public AdminCodeIssued? IssueCode(Guid userId, string purpose, DateTime utcNow)
    {
        Sweep(utcNow);
        var issued = _issued.GetOrAdd(userId, _ => []);
        lock (issued)
        {
            issued.RemoveAll(at => utcNow - at >= TimeSpan.FromHours(1));
            if (issued.Count >= AdminPhoneLockRules.CodesPerHour)
                return null;
            issued.Add(utcNow);
        }

        // A new code retires this account's earlier ones for the same purpose: only the latest email works.
        foreach (var (id, old) in _codes)
        {
            if (old.UserId == userId && old.Purpose == purpose)
                _codes.TryRemove(id, out _);
        }

        var codeId = Token(16);
        var value = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        var expires = utcNow + AdminPhoneLockRules.CodeLifetime;
        _codes[codeId] = new Code(userId, purpose, value, expires);
        return new AdminCodeIssued(codeId, value, expires);
    }

    public AdminCodeCheck CheckCode(Guid userId, string codeId, string code, string purpose, DateTime utcNow)
    {
        if (IsLockedOut(userId, utcNow))
            return AdminCodeCheck.LockedOut;
        if (!_codes.TryGetValue(codeId, out var stored) || stored.UserId != userId || stored.Purpose != purpose)
        {
            RecordFailure(userId, utcNow);
            return IsLockedOut(userId, utcNow) ? AdminCodeCheck.LockedOut : AdminCodeCheck.Wrong;
        }
        if (stored.ExpiresAtUtc <= utcNow)
        {
            _codes.TryRemove(codeId, out _);
            return AdminCodeCheck.Expired;
        }
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(stored.Value), Encoding.ASCII.GetBytes(code)))
        {
            RecordFailure(userId, utcNow);
            return IsLockedOut(userId, utcNow) ? AdminCodeCheck.LockedOut : AdminCodeCheck.Wrong;
        }

        // Spent: a code opens one thing once.
        return _codes.TryRemove(codeId, out _) ? AdminCodeCheck.Ok : AdminCodeCheck.Wrong;
    }

    public bool IsLockedOut(Guid userId, DateTime utcNow)
        => _lockedUntil.TryGetValue(userId, out var until) && until > utcNow;

    public void RecordFailure(Guid userId, DateTime utcNow)
    {
        var failures = _failures.GetOrAdd(userId, _ => []);
        lock (failures)
        {
            failures.RemoveAll(at => utcNow - at >= AdminPhoneLockRules.FailureWindow);
            failures.Add(utcNow);
            if (failures.Count < AdminPhoneLockRules.FailureLimit)
                return;
            failures.Clear();
        }

        _lockedUntil[userId] = utcNow + AdminPhoneLockRules.LockoutFor;
        // Locked out: every pass the account holds on a phone ends too.
        foreach (var (hash, session) in _sessions)
        {
            if (session.UserId == userId)
                _sessions.TryRemove(hash, out _);
        }
    }

    public AdminPhoneSession Open(Guid userId, Guid? keyId, DateTime utcNow, bool fresh = true)
    {
        Sweep(utcNow);
        var token = Token(32);
        var session = new AdminPhoneSession(token, userId, keyId, utcNow, fresh ? utcNow : DateTime.MinValue, Ends(utcNow, utcNow));
        _sessions[Hash(token)] = session with { Token = "" };
        return session;
    }

    public AdminPhoneSession? Touch(string? token, Guid userId, DateTime utcNow)
    {
        if (string.IsNullOrEmpty(token) || !_sessions.TryGetValue(Hash(token), out var session) || session.UserId != userId)
            return null;
        if (session.ExpiresAtUtc <= utcNow)
        {
            _sessions.TryRemove(Hash(token), out _);
            return null;
        }

        var moved = session with { ExpiresAtUtc = Ends(session.OpenedAtUtc, utcNow) };
        _sessions[Hash(token)] = moved;
        return moved with { Token = token };
    }

    public bool MarkFresh(string? token, Guid userId, DateTime utcNow)
    {
        if (Touch(token, userId, utcNow) is not { } session)
            return false;
        _sessions[Hash(token!)] = session with { Token = "", UnlockedAtUtc = utcNow };
        return true;
    }

    public void Close(string? token)
    {
        if (!string.IsNullOrEmpty(token))
            _sessions.TryRemove(Hash(token), out _);
    }

    /// <summary>Idle 5 minutes from now, but never past the hour from when it opened.</summary>
    private static DateTime Ends(DateTime openedAtUtc, DateTime utcNow)
    {
        var idle = utcNow + AdminPhoneLockRules.SessionIdle;
        var max = openedAtUtc + AdminPhoneLockRules.SessionMax;
        return idle < max ? idle : max;
    }

    private void Sweep(DateTime utcNow)
    {
        foreach (var (hash, session) in _sessions)
        {
            if (session.ExpiresAtUtc <= utcNow)
                _sessions.TryRemove(hash, out _);
        }
        foreach (var (id, code) in _codes)
        {
            if (code.ExpiresAtUtc <= utcNow)
                _codes.TryRemove(id, out _);
        }
    }

    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static string Token(int bytes)
        => Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
