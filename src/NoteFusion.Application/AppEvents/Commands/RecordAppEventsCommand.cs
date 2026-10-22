using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.AppEvents.Commands;

/// <summary>One event as the app sends it (mobile <c>AppEventInput</c>). The entity decides what is kept.</summary>
public sealed record AppEventInput(string? Name, string? Detail, DateTime? OccurredAt, string? Id = null);

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
        var batch = request.Events.Take(MaxBatch).ToList();
        // A batch the phone was not sure arrived comes again: what is already stored (by the phone's own id) is not
        // stored twice, and counts as kept so the phone lets it go.
        var ids = batch.Select(e => ClientEventIds.Clean(e.Id)).OfType<string>().Distinct().ToList();
        var seen = ids.Count == 0
            ? new HashSet<string>()
            : (await _db.AppEvents.Where(e => e.UserId == userId && e.ClientId != null && ids.Contains(e.ClientId))
                .Select(e => e.ClientId!).ToListAsync(cancellationToken)).ToHashSet();
        var kept = 0;
        var added = 0;
        foreach (var input in batch)
        {
            if (ClientEventIds.Clean(input.Id) is { } id && !seen.Add(id))
            {
                kept++;
                continue;
            }
            var evt = AppEvent.TryCreate(userId, input.Name, input.Detail, input.OccurredAt, request.DeviceHash, request.Build, now, input.Id);
            if (evt is null)
                continue;
            added++;
            _db.AppEvents.Add(evt);
            kept++;
        }

        if (added > 0)
            await _db.SaveChangesAsync(cancellationToken);

        return new AppEventsResult(kept);
    }
}
