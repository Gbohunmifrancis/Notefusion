using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Offers.Queries;

/// <summary>
/// <c>GET /api/admin/offers/{id}/recipients</c>: who one of the offer's emails (<c>round</c>: "launch" or "lastCall")
/// went to. <c>filter</c>: "opened" (the default: opened or clicked, the newest open first), "clicked", "bought" or
/// "all" (sent first, the newest first). A page of <see cref="PageSize"/> from <c>skip</c>. <c>channel</c>: "email" (the
/// default) or "push" (the same round as a notification, whose open is its tap). Admins only: it names people.
/// </summary>
public sealed record GetOfferRecipientsQuery(Guid Id, string? Round = null, string? Filter = null, int Skip = 0, string? Channel = null)
    : IRequest<Result<OfferRecipientsDto>>;

public sealed class GetOfferRecipientsQueryHandler : IRequestHandler<GetOfferRecipientsQuery, Result<OfferRecipientsDto>>
{
    public const int PageSize = 100;

    private static readonly string[] Filters = ["opened", "clicked", "bought", "all"];

    private readonly IApplicationDbContext _db;

    public GetOfferRecipientsQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<OfferRecipientsDto>> Handle(GetOfferRecipientsQuery request, CancellationToken ct)
    {
        if (OfferAdmin.ParseRound(request.Round) is not { } round)
            return OfferErrors.RoundUnknown;
        var filter = string.IsNullOrWhiteSpace(request.Filter) ? "opened" : request.Filter.Trim().ToLowerInvariant();
        if (!Filters.Contains(filter))
            return OfferErrors.FilterUnknown;
        var channel = string.IsNullOrWhiteSpace(request.Channel) ? "email" : request.Channel.Trim().ToLowerInvariant();
        if (channel is not ("email" or "push"))
            return OfferErrors.ChannelUnknown;
        var push = channel == "push";
        if (!await _db.Offers.AnyAsync(o => o.Id == request.Id, ct))
            return OfferErrors.NotFound;

        var rows = await (
                from e in _db.OfferEmails.AsNoTracking()
                join u in _db.Users.AsNoTracking() on e.UserId equals u.Id
                where e.OfferId == request.Id && e.Round == round && (push ? e.Channel != OfferChannel.Email : e.Channel == OfferChannel.Email)
                select new
                {
                    e.UserId, u.FullName, u.Email, u.Country, e.Group, e.Status, e.SkipReason, e.SentAtUtc, e.OpenedAtUtc, e.ClickedAtUtc,
                })
            .ToListAsync(ct);
        var bought = (await _db.PaymentTransactions.AsNoTracking()
                .Where(t => t.OfferId == request.Id && t.Status == PaymentStatus.Completed)
                .Select(t => new { t.UserId, t.UpdatedAtUtc })
                .ToListAsync(ct))
            .GroupBy(t => t.UserId)
            .ToDictionary(g => g.Key, g => g.Min(t => t.UpdatedAtUtc));

        var all = rows.Select(r =>
        {
            // Opened when its image loaded or, images blocked, when its button was clicked: whichever came first.
            DateTime? opened = r.OpenedAtUtc is { } o && r.ClickedAtUtc is { } c ? (o < c ? o : c) : r.OpenedAtUtc ?? r.ClickedAtUtc;
            return new OfferRecipientDto(
                r.UserId, r.FullName, r.Email, r.Country, r.Group.ToString(), r.Status.ToString(), r.SkipReason?.ToString(),
                r.SentAtUtc, opened, r.ClickedAtUtc, bought.TryGetValue(r.UserId, out var at) ? at : null);
        }).ToList();

        var matching = (filter switch
            {
                "opened" => all.Where(r => r.OpenedAtUtc is not null).OrderByDescending(r => r.OpenedAtUtc),
                "clicked" => all.Where(r => r.ClickedAtUtc is not null).OrderByDescending(r => r.ClickedAtUtc),
                "bought" => all.Where(r => r.BoughtAtUtc is not null).OrderByDescending(r => r.BoughtAtUtc),
                _ => all.OrderByDescending(r => r.SentAtUtc ?? DateTime.MinValue).ThenBy(r => r.Email, StringComparer.Ordinal),
            })
            .ToList();

        return new OfferRecipientsDto(
            OfferAdmin.RoundName(round), filter, matching.Count, all.Count(r => r.OpenedAtUtc is not null),
            matching.Skip(Math.Max(0, request.Skip)).Take(PageSize).ToList(),
            channel);
    }
}
