using MediatR;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Web.Commands;

/// <summary>
/// A tab in sight says it is still open (<c>track.js</c>'s heartbeat): held in memory (<see cref="IWebPresence"/>) for the
/// Traffic page's live count, never stored. A bot's, or one without a browser id or a page, is not kept.
/// </summary>
public sealed record RecordPresenceCommand(string? VisitorId, string? Path, string? UserAgent) : IRequest;

public sealed class RecordPresenceCommandHandler : IRequestHandler<RecordPresenceCommand>
{
    private readonly IWebPresence _presence;
    private readonly IDateTimeProvider _clock;

    public RecordPresenceCommandHandler(IWebPresence presence, IDateTimeProvider clock)
    {
        _presence = presence;
        _clock = clock;
    }

    public Task Handle(RecordPresenceCommand request, CancellationToken cancellationToken)
    {
        var visitor = request.VisitorId?.Trim();
        var path = request.Path?.Trim();
        if (string.IsNullOrEmpty(visitor) || visitor.Length > WebEvent.IdMaxLength || string.IsNullOrEmpty(path) || path[0] != '/'
            || UserAgentFamily.Read(request.UserAgent).IsBot)
            return Task.CompletedTask;
        _presence.Touch(visitor, path.Length > WebEvent.PathMaxLength ? path[..WebEvent.PathMaxLength] : path, _clock.UtcNow);
        return Task.CompletedTask;
    }
}
