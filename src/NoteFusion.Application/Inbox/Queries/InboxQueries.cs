using MediatR;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Inbox.Queries;

// ── DTOs ────────────────────────────────────────────────────────────────────────────────────────

public sealed record InboxEmailSummaryDto(
    Guid Id,
    string Subject,
    string From,
    string To,
    DateTime ReceivedAt,
    bool HasAttachments);

public sealed record InboxEmailDetailDto(
    Guid Id,
    string Subject,
    string From,
    string To,
    DateTime ReceivedAt,
    string? HtmlBody,
    string? TextBody,
    bool HasAttachments);

public sealed record InboxAttachmentDto(
    Guid Id,
    string Filename,
    string ContentType,
    long SizeBytes,
    string DownloadUrl);

public sealed record InboxPageDto(
    IReadOnlyList<InboxEmailSummaryDto> Items,
    int Total,
    int Page,
    int PageSize,
    int TotalPages);

// ── Queries ──────────────────────────────────────────────────────────────────────────────────────

public sealed record GetInboxQuery(int Page = 1, int PageSize = 25)
    : IRequest<Result<InboxPageDto>>;

public sealed record GetInboxEmailQuery(Guid EmailId)
    : IRequest<Result<InboxEmailDetailDto>>;

public sealed record GetInboxAttachmentsQuery(Guid EmailId)
    : IRequest<Result<IReadOnlyList<InboxAttachmentDto>>>;

// ── Handlers ─────────────────────────────────────────────────────────────────────────────────────

public sealed class GetInboxQueryHandler : IRequestHandler<GetInboxQuery, Result<InboxPageDto>>
{
    private readonly IResendInboxService _inbox;

    public GetInboxQueryHandler(IResendInboxService inbox) => _inbox = inbox;

    public async Task<Result<InboxPageDto>> Handle(GetInboxQuery request, CancellationToken ct)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 100);

        var result = await _inbox.ListAsync(page, pageSize, ct);

        var totalPages = pageSize == 0 ? 0 : (int)Math.Ceiling(result.Total / (double)pageSize);
        var items = result.Items.Select(e => new InboxEmailSummaryDto(
            e.Id, e.Subject, e.From, e.To, e.ReceivedAt, e.HasAttachments)).ToList();

        return new InboxPageDto(items, result.Total, page, pageSize, Math.Max(1, totalPages));
    }
}

public sealed class GetInboxEmailQueryHandler : IRequestHandler<GetInboxEmailQuery, Result<InboxEmailDetailDto>>
{
    private readonly IResendInboxService _inbox;

    public GetInboxEmailQueryHandler(IResendInboxService inbox) => _inbox = inbox;

    public async Task<Result<InboxEmailDetailDto>> Handle(GetInboxEmailQuery request, CancellationToken ct)
    {
        var email = await _inbox.GetAsync(request.EmailId, ct);
        return new InboxEmailDetailDto(
            email.Id, email.Subject, email.From, email.To,
            email.ReceivedAt, email.HtmlBody, email.TextBody, email.HasAttachments);
    }
}

public sealed class GetInboxAttachmentsQueryHandler
    : IRequestHandler<GetInboxAttachmentsQuery, Result<IReadOnlyList<InboxAttachmentDto>>>
{
    private readonly IResendInboxService _inbox;

    public GetInboxAttachmentsQueryHandler(IResendInboxService inbox) => _inbox = inbox;

    public async Task<Result<IReadOnlyList<InboxAttachmentDto>>> Handle(
        GetInboxAttachmentsQuery request, CancellationToken ct)
    {
        var attachments = await _inbox.ListAttachmentsAsync(request.EmailId, ct);
        IReadOnlyList<InboxAttachmentDto> dtos = attachments
            .Select(a => new InboxAttachmentDto(a.Id, a.Filename, a.ContentType, a.SizeBytes, a.DownloadUrl))
            .ToList();
        return Result.Success(dtos);
    }
}
