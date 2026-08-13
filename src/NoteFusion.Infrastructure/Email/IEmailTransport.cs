namespace NoteFusion.Infrastructure.Email;

/// <summary>A rendered email, ready to hand to a provider.</summary>
/// <remarks>
/// Both bodies are always supplied. The plain-text part is not optional politeness: an HTML-only
/// message scores worse with spam filters, and text-only clients would otherwise show nothing.
/// </remarks>
public sealed record EmailMessage(
    string ToEmail,
    string? ToName,
    string Subject,
    string HtmlBody,
    string TextBody);

/// <summary>
/// Delivers a rendered message. Kept separate from <see cref="NoteFusion.Application.Common.Interfaces.IEmailSender"/>
/// so the provider can be swapped (or silenced in development) without touching the branding, and so
/// the branding can be tested without any provider at all.
/// </summary>
public interface IEmailTransport
{
    /// <summary>Throws on failure; the caller decides whether a failed email matters.</summary>
    Task SendAsync(EmailMessage message, CancellationToken ct);
}
