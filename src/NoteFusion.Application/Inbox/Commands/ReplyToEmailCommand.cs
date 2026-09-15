using MediatR;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Inbox.Commands;

/// <summary>
/// Sends a reply to a received email. The handler fetches the original message to obtain the
/// sender's address, then dispatches through the existing <see cref="IEmailSender"/> so all
/// replies get the same branded template and audit trail.
/// </summary>
public sealed record ReplyToEmailCommand(
    Guid EmailId,
    string Subject,
    string BodyHtml) : IRequest<Result>;

public sealed class ReplyToEmailCommandHandler : IRequestHandler<ReplyToEmailCommand, Result>
{
    private readonly IResendInboxService _inbox;
    private readonly IEmailSender _emailSender;

    public ReplyToEmailCommandHandler(IResendInboxService inbox, IEmailSender emailSender)
    {
        _inbox = inbox;
        _emailSender = emailSender;
    }

    public async Task<Result> Handle(ReplyToEmailCommand request, CancellationToken ct)
    {
        // Fetch the original to get the sender's address.
        var email = await _inbox.GetAsync(request.EmailId, ct);

        // "From" in a received email is the person who sent it — that is who we reply to.
        var replyTo = new EmailRecipient(Email: ParseAddress(email.From));

        var subject = request.Subject.StartsWith("Re:", StringComparison.OrdinalIgnoreCase)
            ? request.Subject
            : $"Re: {request.Subject}";

        await _emailSender.SendCustomEmailAsync(
            to: replyTo,
            subject: subject,
            heading: string.Empty,
            bodyHtml: request.BodyHtml,
            ctaText: null,
            ctaUrl: null,
            ct: ct);

        return Result.Success();
    }

    /// <summary>
    /// Extracts the raw address from RFC 5322 display-name form ("Name &lt;addr&gt;"),
    /// falling back to the whole string if it is already a bare address.
    /// </summary>
    private static string ParseAddress(string from)
    {
        var start = from.IndexOf('<');
        var end = from.IndexOf('>');
        return start >= 0 && end > start
            ? from[(start + 1)..end].Trim()
            : from.Trim();
    }
}
