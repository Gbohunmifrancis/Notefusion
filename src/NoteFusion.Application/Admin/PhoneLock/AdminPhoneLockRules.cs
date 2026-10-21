using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.PhoneLock;

/// <summary>
/// The phone admin lock, server side (board f-admin/10 revised). A request from the phone (an access token issued to
/// the app, <see cref="ClientKinds.App"/>) reaches an admin route only with an open pass in <see cref="Header"/>, and a
/// pass comes only from this phone's key (sent back from behind its strong fingerprint or face) or, on a phone with no
/// such sensor, the account password plus an emailed code. The browser console is not asked yet.
/// </summary>
public static class AdminPhoneLockRules
{
    /// <summary>The request header carrying the pass.</summary>
    public const string Header = "X-Admin-Session";

    /// <summary>A pass ends this long after its last request: the phone's and the console's own hour without a tap.</summary>
    public static readonly TimeSpan SessionIdle = TimeSpan.FromHours(1);

    /// <summary>However busy, a pass ends this long after the fingerprint that opened it.</summary>
    public static readonly TimeSpan SessionMax = TimeSpan.FromHours(1);

    /// <summary>Suspend, End subscription, Revoke Pro, Change role and flags want a fingerprint this recent.</summary>
    public static readonly TimeSpan FreshFor = TimeSpan.FromSeconds(60);

    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(10);

    /// <summary>Codes one account may ask for in an hour.</summary>
    public const int CodesPerHour = 5;

    /// <summary>Failed tries (a wrong code, a key that does not match) within <see cref="FailureWindow"/> before the lockout.</summary>
    public const int FailureLimit = 5;

    public static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan LockoutFor = TimeSpan.FromMinutes(15);

    /// <summary>Phones one admin may have set up at once; setting up another retires the oldest.</summary>
    public const int MaxKeys = 5;

    public const string PurposeSetup = "setup";
    public const string PurposeUnlock = "unlock";

    public static string Hash(string secret) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));

    /// <summary>Whether a presented secret is this key's, in constant time.</summary>
    public static bool Matches(AdminPhoneKey key, string secret)
        => CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(key.SecretHash), Encoding.ASCII.GetBytes(Hash(secret)));

    /// <summary>"fr•••@gmail.com": enough to know which inbox, not enough to read it off a shoulder.</summary>
    public static string MaskEmail(string email)
    {
        var at = email.IndexOf('@');
        if (at <= 0)
            return "your email";
        var name = email[..at];
        return $"{name[..Math.Min(2, name.Length)]}•••{email[at..]}";
    }
}

public static class AdminPhoneLockErrors
{
    /// <summary>The policy's refusal: a phone's request with no open pass.</summary>
    public static readonly Error Locked = Error.Forbidden(
        "ADMIN_LOCKED", "Admin is locked on this phone. Unlock it with your fingerprint or face.");

    /// <summary>The policy's refusal of a destructive action without a recent fingerprint.</summary>
    public static readonly Error ConfirmRequired = Error.Forbidden(
        "ADMIN_CONFIRM_REQUIRED", "Confirm it with your fingerprint or face first.");

    public static readonly Error KeyInvalid = Error.Validation(
        "ADMIN_PHONE_KEY_INVALID",
        "This phone's Admin key is no longer valid. Set Admin up again with your password and an emailed code.");

    public static readonly Error CodeWrong = Error.Validation(
        "ADMIN_CODE_WRONG", "That code isn't right. Check the email and try again.");

    public static readonly Error CodeExpired = Error.Validation(
        "ADMIN_CODE_EXPIRED", "That code has expired. Ask for a new one.");

    public static readonly Error TooManyCodes = Error.Forbidden(
        "ADMIN_CODE_LIMIT", "That's a lot of codes in an hour. Wait a while, then ask again.");

    public static readonly Error TooManyTries = Error.Forbidden(
        "ADMIN_LOCK_TOO_MANY", "Too many tries. Admin stays locked for 15 minutes.");

    public static readonly Error BadPurpose = Error.Validation(
        "ADMIN_CODE_PURPOSE", "Ask for a code to set Admin up or to open it.");
}

/// <summary>
/// The account password, checked for an admin's own confirmation: a wrong one counts towards the same lockout a wrong
/// sign-in does, so no Admin door is easier to guess at than signing in.
/// </summary>
public static class AdminPassword
{
    public static readonly Error Incorrect =
        Error.Validation("ADMIN_PASSWORD_INCORRECT", "That password is not right. Try again.");

    public static readonly Error NotSet =
        Error.Validation("ADMIN_PASSWORD_NOT_SET",
            "This account signs in with Google, so it has no password to check. Set one with \"Forgot password\" on the sign-in page, then try again.");

    public static readonly Error LockedOut =
        Error.Forbidden("ADMIN_PASSWORD_LOCKED", "Too many tries. Wait 15 minutes, then try again.");

    /// <summary>The caller's account when <paramref name="password"/> is theirs.</summary>
    public static async Task<Result<User>> CheckAsync(
        IApplicationDbContext db, IPasswordHasher hasher, Guid userId, string password, DateTime utcNow, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return AdminErrors.NotAuthenticated;
        if (user.PasswordHash is null)
            return NotSet;
        if (user.IsLockedOut(utcNow))
            return LockedOut;

        if (hasher.Verify(password, user.PasswordHash))
            return user;

        user.RecordFailedLogin(utcNow);
        await db.SaveChangesAsync(ct);
        return user.IsLockedOut(utcNow) ? LockedOut : Incorrect;
    }
}
