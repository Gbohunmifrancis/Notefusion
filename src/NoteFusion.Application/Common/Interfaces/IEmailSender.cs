namespace NoteFusion.Application.Common.Interfaces;

/// <summary>An email recipient. The name is optional — Google accounts can arrive without one.</summary>
public sealed record EmailRecipient(string Email, string? Name = null);

/// <summary>
/// The facts a subscription receipt states. Minor units (cents) because that is what the payment
/// providers settle in and what the ledger stores — formatting for humans happens at render time.
/// </summary>
public sealed record SubscriptionReceipt(
    string PlanName,
    long AmountMinor,
    string Currency,
    DateTime RenewsAtUtc,
    string Reference);

/// <summary>
/// The transactional emails the app sends. Methods name the event, not the message, so the copy and
/// the layout can change without touching a handler — and so a handler cannot accidentally decide
/// what an email looks like.
/// </summary>
/// <remarks>
/// Delivery is best-effort: implementations log failures and never throw. An email provider being
/// down must not fail a registration or, worse, abort a payment that already settled. Callers should
/// send after their <c>SaveChangesAsync</c> for the same reason — the state change is what matters.
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

    /// <summary>Receipt for a payment that has been verified and fulfilled.</summary>
    Task SendSubscriptionReceiptAsync(
        EmailRecipient to, SubscriptionReceipt receipt, CancellationToken ct = default);

    /// <summary>
    /// Sent when the provider reports a checkout did not go through, so the user knows the upgrade
    /// did not happen and can retry rather than waiting for a subscription that will never start.
    /// </summary>
    Task SendPaymentFailedAsync(EmailRecipient to, string planName, CancellationToken ct = default);
}
