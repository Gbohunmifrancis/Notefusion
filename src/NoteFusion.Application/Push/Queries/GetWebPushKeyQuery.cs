using MediatR;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Push.Queries;

/// <summary>The VAPID public key a browser subscribes with (<c>applicationServerKey</c>).</summary>
public sealed record WebPushKeyDto(string PublicKey);

public sealed record GetWebPushKeyQuery : IRequest<Result<WebPushKeyDto>>;

/// <summary>Public by nature (every subscribing browser is handed it); <c>WEBPUSH_OFF</c> when web push is off.</summary>
public sealed class GetWebPushKeyQueryHandler : IRequestHandler<GetWebPushKeyQuery, Result<WebPushKeyDto>>
{
    private readonly IWebPushKeys _keys;

    public GetWebPushKeyQueryHandler(IWebPushKeys keys) => _keys = keys;

    public Task<Result<WebPushKeyDto>> Handle(GetWebPushKeyQuery request, CancellationToken ct)
        => Task.FromResult(_keys.PublicKey is { } key
            ? Result<WebPushKeyDto>.Success(new WebPushKeyDto(key))
            : Result.Failure<WebPushKeyDto>(WebPush.Off));
}
