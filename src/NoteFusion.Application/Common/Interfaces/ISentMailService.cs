namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Reads the email this app has sent, as the provider keeps it (Resend's sent-email log): who it went to, the subject,
/// whether it was delivered, and the body. Infrastructure owns the implementation.
/// </summary>
public interface ISentMailService
{
    /// <summary>One page of sent email, newest first; null when the provider could not be read.</summary>
    Task<SentMailPage?> ListAsync(int page, int pageSize, CancellationToken ct = default);

    /// <summary>One sent email in full; null when the provider does not know it or could not be read.</summary>
    Task<SentMail?> GetAsync(Guid emailId, CancellationToken ct = default);
}

public sealed record SentMailPage(IReadOnlyList<SentMailSummary> Items, bool HasMore, int Total);

/// <param name="LastEvent">The provider's latest word on it: sent, delivered, opened, clicked, bounced, complained…</param>
public sealed record SentMailSummary(Guid Id, string Subject, string From, string To, DateTime SentAt, string? LastEvent);

public sealed record SentMail(
    Guid Id, string Subject, string From, string To, DateTime SentAt, string? LastEvent, string? HtmlBody, string? TextBody);
