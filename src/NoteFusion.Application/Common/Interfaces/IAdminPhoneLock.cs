namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// An open Admin pass on a phone (<c>X-Admin-Session</c>): what the admin policy asks a phone's token for on every
/// request. <paramref name="UnlockedAtUtc"/> is the last fingerprint or password, which the destructive actions want
/// recent; <paramref name="ExpiresAtUtc"/> moves on with each request, up to the pass's absolute end.
/// </summary>
public sealed record AdminPhoneSession(
    string Token, Guid UserId, Guid? KeyId, DateTime OpenedAtUtc, DateTime UnlockedAtUtc, DateTime ExpiresAtUtc);

/// <summary>A six-digit code to email, and how to name it back.</summary>
public sealed record AdminCodeIssued(string CodeId, string Code, DateTime ExpiresAtUtc);

public enum AdminCodeCheck
{
    Ok,
    Wrong,
    Expired,
    LockedOut,
}

/// <summary>
/// The phone admin lock's short-lived state: emailed codes, failed tries and open passes. In memory, as the passkey
/// challenges and the quota gate are: one API instance, and a restart only means a fingerprint again. The numbers are
/// <c>AdminPhoneLockRules</c>.
/// </summary>
public interface IAdminPhoneLock
{
    /// <summary>A new code for <paramref name="purpose"/> ("setup" or "unlock"); null past the hourly limit.</summary>
    AdminCodeIssued? IssueCode(Guid userId, string purpose, DateTime utcNow);

    /// <summary>Checks a typed code. A right one is spent; a wrong one counts as a failed try.</summary>
    AdminCodeCheck CheckCode(Guid userId, string codeId, string code, string purpose, DateTime utcNow);

    /// <summary>Whether too many tries have failed lately for this account to try again yet.</summary>
    bool IsLockedOut(Guid userId, DateTime utcNow);

    void RecordFailure(Guid userId, DateTime utcNow);

    AdminPhoneSession Open(Guid userId, Guid? keyId, DateTime utcNow);

    /// <summary>The caller's open pass, moved on to now; null when it is not theirs, has ended or never was.</summary>
    AdminPhoneSession? Touch(string? token, Guid userId, DateTime utcNow);

    /// <summary>Records a fresh password check on an open pass (the no-sensor phone's confirm).</summary>
    bool MarkFresh(string? token, Guid userId, DateTime utcNow);

    void Close(string? token);
}
