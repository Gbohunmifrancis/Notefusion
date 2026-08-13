using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// Turns account events into branded, delivered email. Renders with
/// <see cref="BrandedEmailTemplate"/> and hands the result to whichever
/// <see cref="IEmailTransport"/> is configured.
/// </summary>
/// <remarks>
/// Nothing here throws. Every send is wrapped, because the events that trigger email are events that
/// already happened: the account exists, the password changed, the money moved. Surfacing a mail
/// failure to the caller would turn a delivered outcome into an error the client reports as one — and
/// in the payment case would strand a settled charge. A failure is a logged warning instead.
/// </remarks>
public sealed class EmailSender : IEmailSender
{
    private readonly BrandedEmailTemplate _template;
    private readonly IEmailTransport _transport;
    private readonly ILogger<EmailSender> _logger;

    public EmailSender(
        BrandedEmailTemplate template, IEmailTransport transport, ILogger<EmailSender> logger)
    {
        _template = template;
        _transport = transport;
        _logger = logger;
    }

    public Task SendWelcomeAsync(EmailRecipient to, CancellationToken ct = default)
        => TrySendAsync(_template.Welcome(to), ct);

    public Task SendPasswordChangedAsync(EmailRecipient to, CancellationToken ct = default)
        => TrySendAsync(_template.PasswordChanged(to), ct);

    public Task SendSubscriptionReceiptAsync(
        EmailRecipient to, SubscriptionReceipt receipt, CancellationToken ct = default)
        => TrySendAsync(_template.SubscriptionReceipt(to, receipt), ct);

    public Task SendPaymentFailedAsync(EmailRecipient to, string planName, CancellationToken ct = default)
        => TrySendAsync(_template.PaymentFailed(to, planName), ct);

    public Task SendPasswordResetAsync(EmailRecipient to, string resetUrl, CancellationToken ct = default)
        => TrySendAsync(_template.PasswordReset(to, resetUrl), ct);

    private async Task TrySendAsync(EmailMessage message, CancellationToken ct)
    {
        try
        {
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
        }
    }
}
