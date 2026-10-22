using MediatR;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.AppEvents.Commands;

/// <summary>One event as the app sends it (mobile <c>AppEventInput</c>). The entity decides what is kept.</summary>
public sealed record AppEventInput(string? Name, string? Detail, DateTime? OccurredAt);

/// <summary>What a batch kept.</summary>
public sealed record AppEventsResult(int Accepted);

/// <summary>
/// A batch of the phone's own events (Listen from anywhere today) for the signed-in account. A malformed event is dropped
/// and the rest are kept; past <see cref="MaxBatch"/> the batch is cut. The app retries what it could not send, so the
/// answer is how many were kept, and never an error for the events themselves.
/// </summary>
public sealed record RecordAppEventsCommand(
    int Build,
    IReadOnlyList<AppEventInput> Events,
    /// <summary>The phone's device id, already hashed by the Api layer; null when it sent none.</summary>
    string? DeviceHash = null) : IRequest<Result<AppEventsResult>>;

public sealed class RecordAppEventsCommandHandler : IRequestHandler<RecordAppEventsCommand, Result<AppEventsResult>>
{
    /// <summary>The app sends at most this many a call (lib/appEvents BATCH).</summary>
    public const int MaxBatch = 50;

    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public RecordAppEventsCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<AppEventsResult>> Handle(RecordAppEventsCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var now = _clock.UtcNow;
        var kept = 0;
        foreach (var input in request.Events.Take(MaxBatch))
        {
            var evt = AppEvent.TryCreate(userId, input.Name, input.Detail, input.OccurredAt, request.DeviceHash, request.Build, now);
            if (evt is null)
                continue;
            _db.AppEvents.Add(evt);
            kept++;
        }

        if (kept > 0)
            await _db.SaveChangesAsync(cancellationToken);

        return new AppEventsResult(kept);
    }
}
