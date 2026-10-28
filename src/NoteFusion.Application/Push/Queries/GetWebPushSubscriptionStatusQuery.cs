using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Application.Push.Queries;

/// <summary>Whether this server still holds a browser's subscription for the caller and audience.</summary>
public sealed record WebPushSubscriptionStatusDto(bool Registered);

/// <summary>
/// Asked by the console when it opens: a browser can believe it is subscribed after the server dropped its row (the push
/// service said it was gone, or refused it five times), and would then hear nothing while showing "on".
/// </summary>
public sealed record GetWebPushSubscriptionStatusQuery(Guid UserId, string Endpoint, string Audience) : IRequest<WebPushSubscriptionStatusDto>;

public sealed class GetWebPushSubscriptionStatusQueryHandler
    : IRequestHandler<GetWebPushSubscriptionStatusQuery, WebPushSubscriptionStatusDto>
{
    private readonly IApplicationDbContext _db;

    public GetWebPushSubscriptionStatusQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<WebPushSubscriptionStatusDto> Handle(GetWebPushSubscriptionStatusQuery request, CancellationToken ct)
        => new(await _db.WebPushSubscriptions.AnyAsync(
            s => s.UserId == request.UserId && s.Audience == request.Audience && s.Endpoint == request.Endpoint, ct));
}
