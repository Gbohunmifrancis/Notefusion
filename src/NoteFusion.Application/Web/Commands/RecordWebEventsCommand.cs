using MediatR;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Web.Commands;

/// <summary>One event as the browser's tracker sends it. Every field is optional on the wire; the entity decides what is kept.</summary>
public sealed record WebEventInput(
    string? Kind,
    string? Name,
    string? Path,
    string? Target,
    string? Referrer,
    string? Device,
    /// <summary>Milliseconds the event waited in the browser's queue before this batch was sent; it is subtracted from "now".</summary>
    int? AgeMs,
    /// <summary>What else an action carries (an error code, a provider); ignored for page views and clicks.</summary>
    string? Detail = null);

/// <summary>
/// A batch of page views, clicks and app actions from one browser. Anonymous: a visitor is counted
/// without an account, and the account is attached only when the request carries a valid token.
/// </summary>
/// <remarks>
/// Nothing here is refused. A malformed event is dropped and the rest are kept, an unknown kind is
/// dropped, an oversized batch is cut at <see cref="MaxBatch"/>, and an empty batch is a no-op.
/// The tracker fires on page unload with no one to read an error, so the only useful outcome is
/// "keep what is well-formed".
/// </remarks>
public sealed record RecordWebEventsCommand(
    string? VisitorId,
    string? SessionId,
    IReadOnlyList<WebEventInput> Events,
    /// <summary>The browser's device id, already hashed by the Api layer; null when it sent none.</summary>
    string? DeviceHash = null) : IRequest<Result<int>>;

public sealed class RecordWebEventsCommandHandler : IRequestHandler<RecordWebEventsCommand, Result<int>>
{
    /// <summary>A browser flushes every few seconds, so a batch this size is already abnormal.</summary>
    public const int MaxBatch = 50;

    /// <summary>An event older than this was queued before a long sleep; it is stamped at the cap rather than trusted.</summary>
    private const int MaxAgeMs = 5 * 60 * 1000;

    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public RecordWebEventsCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<int>> Handle(RecordWebEventsCommand request, CancellationToken cancellationToken)
    {
        var now = _clock.UtcNow;
        var userId = _currentUser.UserId;
        var kept = 0;

        foreach (var input in request.Events.Take(MaxBatch))
        {
            var age = Math.Clamp(input.AgeMs ?? 0, 0, MaxAgeMs);
            var evt = WebEvent.TryCreate(
                input.Kind, input.Name, input.Path, input.Target, input.Referrer,
                request.VisitorId, request.SessionId, userId, input.Device, now.AddMilliseconds(-age),
                input.Detail, request.DeviceHash);
            if (evt is null)
                continue;
            _db.WebEvents.Add(evt);
            kept++;
        }

        if (kept > 0)
            await _db.SaveChangesAsync(cancellationToken);

        return kept;
    }
}
