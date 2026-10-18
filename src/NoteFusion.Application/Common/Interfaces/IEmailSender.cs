using NoteFusion.Application.Outreach;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>An email recipient. The name is optional — Google accounts can arrive without one.</summary>
public sealed record EmailRecipient(string Email, string? Name = null);

/// <summary>
/// The facts a subscription receipt states. Minor units (cents) because that is what the payment
/// providers settle in and what the ledger stores — formatting for humans happens at render time.
/// </summary>
/// <param name="RenewsAtUtc">
/// When the next charge falls due, or <c>null</c> for a plan that was bought outright and never
/// renews. Nullable rather than a far-future date so the renderer cannot print the internal sentinel:
/// a lifetime receipt reading "renews on 31 December 9999" would look like a bug to the one person
/// who just paid us the most.
/// </param>
/// <param name="OneTranscription">
/// A one-song purchase rather than Pro time: the receipt says one transcription was added, and nothing about
/// a membership.
/// </param>
public sealed record SubscriptionReceipt(
    string PlanName,
    long AmountMinor,
    string Currency,
    DateTime? RenewsAtUtc,
    string Reference,
    bool OneTranscription = false);

/// <summary>
/// The facts an "expiring soon" notice states. <paramref name="WillRenew"/> is the difference between
/// a reminder and a warning: a cancelled subscription is about to stop, an active one is about to
/// charge. Getting that line wrong is worse than not sending the email.
/// </summary>
public sealed record SubscriptionExpiry(
    string PlanName,
    DateTime ExpiresAtUtc,
    int DaysLeft,
    bool WillRenew);

/// <summary>
/// The transactional emails the app sends. Methods name the event, not the message, so the copy and
/// the layout can change without touching a handler — and so a handler cannot accidentally decide
/// what an email looks like.
/// </summary>
/// <remarks>
/// Delivery is best-effort: implementations log failures and never throw. An email provider being
/// down must not fail a registration or, worse, abort a payment that already settled. Callers should
/// send after their <c>SaveChangesAsync</c> for the same reason — the state change is what matters.
/// The optional ones (welcome, waitlist confirmation, checkout reminder, transcription tips, outreach) are
/// skipped while the sending quota holds them (<see cref="EmailBudget"/>); a batch that must not lose one
/// asks <see cref="IEmailQuota"/> before claiming it.
/// </remarks>
public interface IEmailSender
{
    /// <summary>Sent once, when an account is created (password sign-up or first Google sign-in).</summary>
    Task SendWelcomeAsync(EmailRecipient to, CancellationToken ct = default);

    /// <summary>
    /// Security notice for a password change. Sent even though the user just did it themselves:
    /// if they did not, this is the only way they find out.
    /// </summary>
    Task SendPasswordChangedAsync(EmailRecipient to, CancellationToken ct = default);

    /// <summary>
    /// Tells the owner of an address that somebody tried to register it again, in place of the "already
    /// exists" answer registration no longer gives (that answer told anyone who asked who has an account).
    /// </summary>
    Task SendAccountAlreadyExistsAsync(EmailRecipient to, CancellationToken ct = default);

    /// <summary>Receipt for a payment that has been verified and fulfilled.</summary>
    Task SendSubscriptionReceiptAsync(
        EmailRecipient to, SubscriptionReceipt receipt, CancellationToken ct = default);

    /// <summary>
    /// Sent when the provider reports a checkout did not go through, so the user knows the upgrade
    /// did not happen and can retry rather than waiting for a subscription that will never start.
    /// </summary>
    Task SendPaymentFailedAsync(EmailRecipient to, string planName, CancellationToken ct = default);

    /// <summary>
    /// Sent a couple of hours after a Pro checkout was opened and not finished: nothing was charged,
    /// here is the way back, and write to us if something went wrong.
    /// </summary>
    Task SendCheckoutAbandonedAsync(EmailRecipient to, string planName, CancellationToken ct = default);

    /// <summary>
    /// Sent once per billing period, shortly before it ends, so a renewal charge is never a surprise
    /// and a lapse is never a silent one.
    /// </summary>
    Task SendSubscriptionExpiringAsync(
        EmailRecipient to, SubscriptionExpiry expiry, CancellationToken ct = default);

    /// <summary>
    /// Sends a password-reset link. The link expires in 1 hour and contains the raw
    /// token — the caller must have already stored the <em>hash</em> on the user row.
    /// </summary>
    Task SendPasswordResetAsync(EmailRecipient to, string resetUrl, CancellationToken ct = default);

    /// <summary>
    /// Sends the six-digit code that confirms a new account's address. As with the reset link, the
    /// caller passes the plaintext and must already have stored only its hash.
    /// </summary>
    /// <remarks>
    /// The one email in this interface whose delivery a user is actively waiting on: until the code
    /// arrives they have no account they can sign into. Still best-effort by contract — a mail outage
    /// leaves them able to ask for another code, whereas a failed registration leaves them nothing.
    /// </remarks>
    Task SendEmailVerificationAsync(EmailRecipient to, string code, CancellationToken ct = default);

    /// <summary>
    /// Sends a custom branded message drafted by an administrator to the specified recipient.
    /// </summary>
    Task SendCustomEmailAsync(
        EmailRecipient to,
        string subject,
        string heading,
        string bodyHtml,
        string? ctaText = null,
        string? ctaUrl = null,
        CancellationToken ct = default);

    /// <summary>
    /// Sends a branded confirmation email to a newly registered waitlist subscriber.
    /// </summary>
    Task SendWaitlistConfirmationAsync(EmailRecipient to, CancellationToken ct = default);

    /// <summary>
    /// Sent after a transcription of theirs failed (at most once a week): it cost nothing, three things that
    /// make the next one work, and the way back to the app.
    /// </summary>
    /// <param name="onPro">Pro accounts are told their allowance is untouched rather than their free tries.</param>
    Task SendTranscriptionFailedAsync(EmailRecipient to, bool onPro, CancellationToken ct = default);

    /// <summary>
    /// A personal customer-research note from the founder (<c>SendOutreach</c>), with replies going to
    /// <see cref="OutreachEmail.ReplyTo"/> and a one-click unsubscribe link. The one send here that reports
    /// how it went: the outreach audit trail records a failed delivery, and tries it once more. Never throws.
    /// </summary>
    Task<Result> SendOutreachAsync(EmailRecipient to, OutreachEmail email, CancellationToken ct = default);
}
