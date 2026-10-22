using System.Text.RegularExpressions;

namespace NoteFusion.Application.Inbox.Sent;

/// <summary>
/// What the console's Sent mail never shows: a sign-in code or a one-time link someone else could use. A verification
/// or Admin code is in its subject (so a phone's preview shows it), so the subject's code is masked; those emails, the
/// password reset and the account-deletion confirmation keep their bodies back. Everything else reads as sent.
/// </summary>
/// <remarks>
/// Recognised by subject, which the templates take from here, so a reworded subject cannot slip a code past it.
/// </remarks>
public static partial class SentMailPrivacy
{
    public const string PasswordResetSubject = "Reset your NoteFusion password";
    public const string DeletionConfirmSubject = "Confirm your NoteFusion account deletion request";
    public const string VerificationCodeSuffix = " is your NoteFusion verification code";
    public const string AdminCodeSuffix = " is your NoteFusion Admin code";

    /// <summary>Shown in place of a code.</summary>
    public const string Mask = "••••••";

    [GeneratedRegex(@"^\s*\S+(?= is your NoteFusion (verification|Admin) code)")]
    private static partial Regex CodeSubject();

    /// <summary>The subject as the console shows it: a code in it masked.</summary>
    public static string Subject(string subject) => CodeSubject().Replace(subject, Mask, 1);

    /// <summary>Whether the email's body is kept back: it holds a code or a one-time link.</summary>
    public static bool HidesBody(string subject)
        => CodeSubject().IsMatch(subject)
           || subject.Trim().Equals(PasswordResetSubject, StringComparison.OrdinalIgnoreCase)
           || subject.Trim().Equals(DeletionConfirmSubject, StringComparison.OrdinalIgnoreCase);
}
