using System.Security.Cryptography;
using System.Text;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Auth.Services;

/// <summary>
/// Issues and checks the one-time codes that confirm an email address. Three commands issue one
/// (register, resend, and a login by someone who never finished signing up) and one checks it, so the
/// hashing lives here rather than four times over — a code compared against the wrong hash shape is a
/// bug that reads as "the user typed it wrong".
/// </summary>
/// <remarks>
/// SHA-256, as with the reset token: the value is machine-generated, so a slow hash buys nothing against
/// a stolen database that could enumerate all 10⁶ six-digit codes regardless. What protects the code is
/// its 10-minute life and the attempt cap on the row, both of which live on <see cref="User"/> and
/// therefore cannot be skipped by a caller that forgets them.
/// </remarks>
public static class EmailVerificationCodes
{
    /// <summary>
    /// Stamps a fresh code on <paramref name="user"/> and returns the plaintext to mail. Only the hash is
    /// stored, so this return value is the sole copy — mail it after <c>SaveChangesAsync</c>, per the
    /// <see cref="IEmailSender"/> contract, and never log it.
    /// </summary>
    public static string Issue(User user, ISecureTokenGenerator generator, DateTime utcNow)
    {
        var code = generator.GenerateNumericCode();
        user.SetEmailVerificationCode(Hash(code), utcNow);
        return code;
    }

    /// <summary>
    /// Checks a code the user typed and, on a match, marks the address verified. False covers wrong,
    /// expired, already-used and out-of-attempts alike — the caller has one error for all four because
    /// telling them apart is only useful to someone guessing.
    /// </summary>
    public static bool Consume(User user, string code, DateTime utcNow)
        => user.ConsumeEmailVerificationCode(Hash(code.Trim()), utcNow);

    private static string Hash(string code)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code))).ToLowerInvariant();
}
