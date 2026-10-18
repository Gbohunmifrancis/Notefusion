using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Outreach;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// Turns account events into branded, delivered email. Renders with
/// <see cref="BrandedEmailTemplate"/> and hands the result to whichever
/// <see cref="IEmailTransport"/> is configured.
/// </summary>
/// <remarks>
/// <para>
/// Nothing here throws. Every send is wrapped, because the events that trigger email are events that
/// already happened: the account exists, the password changed, the money moved. Surfacing a mail
/// failure to the caller would turn a delivered outcome into an error the client reports as one — and
/// in the payment case would strand a settled charge. A failure is a logged warning instead.
/// </para>
/// <para>
/// Every send names its <see cref="EmailKind"/>. An optional one asks the sending quota first and is skipped
/// when the quota holds it (<see cref="EmailBudget"/>); every one the provider accepts is recorded.
/// </para>
/// </remarks>
public sealed class EmailSender : IEmailSender
{
    private readonly BrandedEmailTemplate _template;
    private readonly IEmailTransport _transport;
    private readonly ILogger<EmailSender> _logger;
    private readonly IEmailQuota _quota;

    public EmailSender(
        BrandedEmailTemplate template, IEmailTransport transport, ILogger<EmailSender> logger, IEmailQuota? quota = null)
    {
        _template = template;
        _transport = transport;
        _logger = logger;
        _quota = quota ?? EmailBudget.Unlimited;
    }

    public Task SendWelcomeAsync(EmailRecipient to, CancellationToken ct = default)
        => TrySendAsync(EmailKind.Welcome, _template.Welcome(to), ct);

    public Task SendWaitlistConfirmationAsync(EmailRecipient to, CancellationToken ct = default)
        => TrySendAsync(EmailKind.WaitlistConfirmation, _template.WaitlistConfirmation(to), ct);

    public Task SendPasswordChangedAsync(EmailRecipient to, CancellationToken ct = default)
        => TrySendAsync(EmailKind.PasswordChanged, _template.PasswordChanged(to), ct);

    public Task SendSubscriptionReceiptAsync(
        EmailRecipient to, SubscriptionReceipt receipt, CancellationToken ct = default)
        => TrySendAsync(EmailKind.Receipt, _template.SubscriptionReceipt(to, receipt), ct);

    public Task SendPaymentFailedAsync(EmailRecipient to, string planName, CancellationToken ct = default)
        => TrySendAsync(EmailKind.PaymentFailed, _template.PaymentFailed(to, planName), ct);

    public Task SendCheckoutAbandonedAsync(EmailRecipient to, string planName, CancellationToken ct = default)
        => TrySendAsync(EmailKind.CheckoutReminder, _template.CheckoutAbandoned(to, planName), ct);

    public Task SendSubscriptionExpiringAsync(
        EmailRecipient to, SubscriptionExpiry expiry, CancellationToken ct = default)
        => TrySendAsync(EmailKind.SubscriptionExpiring, _template.SubscriptionExpiring(to, expiry), ct);

    public Task SendAccountAlreadyExistsAsync(EmailRecipient to, CancellationToken ct = default)
        => TrySendAsync(EmailKind.AccountAlreadyExists, _template.AccountAlreadyExists(to), ct);

    public Task SendPasswordResetAsync(EmailRecipient to, string resetUrl, CancellationToken ct = default)
        => TrySendAsync(EmailKind.PasswordReset, _template.PasswordReset(to, resetUrl), ct);

    public Task SendEmailVerificationAsync(EmailRecipient to, string code, CancellationToken ct = default)
        => TrySendAsync(EmailKind.Verification, _template.VerifyEmail(to, code), ct);

    public Task SendAdminCodeAsync(EmailRecipient to, string code, bool setup, CancellationToken ct = default)
        => TrySendAsync(EmailKind.AdminCode, _template.AdminCode(to, code, setup), ct);

    public Task SendAdminPhoneAddedAsync(EmailRecipient to, string phoneLabel, DateTime atUtc, CancellationToken ct = default)
        => TrySendAsync(EmailKind.AdminPhoneAdded, _template.AdminPhoneAdded(to, phoneLabel, atUtc), ct);

    public Task SendTranscriptionFailedAsync(EmailRecipient to, bool onPro, CancellationToken ct = default)
        => TrySendAsync(EmailKind.TranscriptionTips, _template.TranscriptionFailed(to, onPro), ct);

    public Task SendCustomEmailAsync(
        EmailRecipient to,
        string subject,
        string heading,
        string bodyHtml,
        string? ctaText = null,
        string? ctaUrl = null,
        CancellationToken ct = default)
        => TrySendAsync(EmailKind.Custom, _template.Custom(to, subject, heading, bodyHtml, ctaText, ctaUrl), ct);

    public async Task<Result> SendOutreachAsync(EmailRecipient to, OutreachEmail email, CancellationToken ct = default)
    {
        // Held by the quota: nothing went, so the outreach keeps the message for a later run, as below.
        if (!await _quota.AllowsOptionalAsync(EmailKind.Outreach, ct))
            return Result.Failure(EmailBudget.Held);

        var message = _template.Outreach(to, email);
        try
        {
            await _transport.SendAsync(message, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not send outreach \"{Subject}\" to {Recipient}.", message.Subject, message.ToEmail);
            // Not sent at all, so the outreach keeps the message for a later run instead of spending a try.
            if (ex is EmailDeliveryException { ProviderUnavailable: true })
                return Result.Failure(ProviderErrors.Unavailable);
            return Result.Failure(Error.Failure("EMAIL_DELIVERY_FAILED", ex.Message));
        }

        await _quota.RecordSentAsync(EmailKind.Outreach);
        return Result.Success();
    }

    private async Task TrySendAsync(EmailKind kind, EmailMessage message, CancellationToken ct)
    {
        try
        {
            // The quota logs the hold; an inline optional email has nothing to retry it later.
            if (EmailBudget.IsOptional(kind) && !await _quota.AllowsOptionalAsync(kind, ct))
                return;

            await _transport.SendAsync(message, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Shutdown, or the client hung up. Not a delivery problem worth a warning.
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex, "Could not send \"{Subject}\" to {Recipient}.", message.Subject, message.ToEmail);
            return;
        }

        await _quota.RecordSentAsync(kind);
    }
}
