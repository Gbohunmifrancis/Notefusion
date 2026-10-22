using MediatR;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Inbox.Sent;

// ── DTOs ────────────────────────────────────────────────────────────────────────────────────────

/// <param name="Status">The provider's latest event (delivered, opened, bounced…), null when it has none yet.</param>
public sealed record SentEmailSummaryDto(Guid Id, string Subject, string From, string To, DateTime SentAt, string? Status);

/// <param name="BodyWithheld">The email holds a code or a one-time link (<see cref="SentMailPrivacy"/>): no body is sent.</param>
public sealed record SentEmailDetailDto(
    Guid Id, string Subject, string From, string To, DateTime SentAt, string? Status,
    string? HtmlBody, string? TextBody, bool BodyWithheld);

public sealed record SentPageDto(IReadOnlyList<SentEmailSummaryDto> Items, int Total, int Page, int PageSize, int TotalPages);

// ── Queries ─────────────────────────────────────────────────────────────────────────────────────

/// <summary>The console's Sent mail: every email the app sent, newest first, codes masked.</summary>
public sealed record GetSentMailQuery(int Page = 1, int PageSize = 25) : IRequest<Result<SentPageDto>>;

/// <summary>One sent email; the body of one holding a code or a one-time link is withheld.</summary>
public sealed record GetSentEmailQuery(Guid EmailId) : IRequest<Result<SentEmailDetailDto>>;

internal static class SentMailErrors
{
    public static readonly Error Unavailable =
        Error.Failure("SENT_MAIL_UNAVAILABLE", "The sent mail could not be read from the email provider. Try again in a minute.");

    public static readonly Error NotFound =
        Error.NotFound("SENT_MAIL_NOT_FOUND", "That email was not found in the sent mail.");
}

public sealed class GetSentMailQueryHandler : IRequestHandler<GetSentMailQuery, Result<SentPageDto>>
{
    private readonly ISentMailService _sent;

    public GetSentMailQueryHandler(ISentMailService sent) => _sent = sent;

    public async Task<Result<SentPageDto>> Handle(GetSentMailQuery request, CancellationToken ct)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 100);

        var result = await _sent.ListAsync(page, pageSize, ct);
        if (result is null)
            return SentMailErrors.Unavailable;

        var items = result.Items
            .Select(e => new SentEmailSummaryDto(e.Id, SentMailPrivacy.Subject(e.Subject), e.From, e.To, e.SentAt, e.LastEvent))
            .ToList();
        var totalPages = (int)Math.Ceiling(result.Total / (double)pageSize);
        return new SentPageDto(items, result.Total, page, pageSize, Math.Max(1, totalPages));
    }
}

public sealed class GetSentEmailQueryHandler : IRequestHandler<GetSentEmailQuery, Result<SentEmailDetailDto>>
{
    private readonly ISentMailService _sent;

    public GetSentEmailQueryHandler(ISentMailService sent) => _sent = sent;

    public async Task<Result<SentEmailDetailDto>> Handle(GetSentEmailQuery request, CancellationToken ct)
    {
        var email = await _sent.GetAsync(request.EmailId, ct);
        if (email is null)
            return SentMailErrors.NotFound;

        var withheld = SentMailPrivacy.HidesBody(email.Subject);
        return new SentEmailDetailDto(
            email.Id, SentMailPrivacy.Subject(email.Subject), email.From, email.To, email.SentAt, email.LastEvent,
            withheld ? null : email.HtmlBody,
            withheld ? null : email.TextBody,
            withheld);
    }
}
