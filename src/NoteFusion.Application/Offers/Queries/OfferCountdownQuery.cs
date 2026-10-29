using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Offers.Queries;

/// <summary>What the countdown counts to: the offer's end for the person its email went to, and its skin.</summary>
public sealed record OfferCountdownDto(TimeSpan Left, string Template);

/// <summary>
/// <c>GET /api/offers/countdown?o={key}&amp;m={token}</c>: the time left until the offer ends for the person whose last
/// call carries <c>m</c> (at midnight after its last day in their own time zone), or for the UK without one (a preview
/// or a test). Nothing for a key that names no offer: the endpoint then draws a clock at nothing.
/// </summary>
public sealed record GetOfferCountdownQuery(string? Key, string? Token) : IRequest<Result<OfferCountdownDto>>;

public sealed class GetOfferCountdownQueryHandler : IRequestHandler<GetOfferCountdownQuery, Result<OfferCountdownDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetOfferCountdownQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<OfferCountdownDto>> Handle(GetOfferCountdownQuery request, CancellationToken ct)
    {
        var key = request.Key?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length > Offer.KeyMaxLength)
            return new OfferCountdownDto(TimeSpan.Zero, OfferTemplates.Halloween);
        var offer = await _db.Offers.AsNoTracking().FirstOrDefaultAsync(o => o.Key == key, ct);
        if (offer is null)
            return new OfferCountdownDto(TimeSpan.Zero, OfferTemplates.Halloween);

        string? zone = null;
        var token = request.Token?.Trim();
        if (!string.IsNullOrEmpty(token) && token.Length >= OfferTokens.MinLength && token.Length <= OfferEmail.TokenMaxLength)
        {
            zone = await (
                    from e in _db.OfferEmails.AsNoTracking()
                    join u in _db.Users.AsNoTracking() on e.UserId equals u.Id
                    where e.Token == token && e.OfferId == offer.Id
                    select u.TimeZone)
                .FirstOrDefaultAsync(ct);
        }

        var left = OfferWindow.EndsAtUtc(offer, OfferWindow.Resolve(zone)) - _clock.UtcNow;
        return new OfferCountdownDto(left < TimeSpan.Zero ? TimeSpan.Zero : left, offer.Template);
    }
}
