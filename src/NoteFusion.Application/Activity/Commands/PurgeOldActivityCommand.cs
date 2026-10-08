using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Activity.Commands;

/// <summary>How many rows a purge removed from each table.</summary>
public sealed record PurgeOldActivityResult(int WebEvents, int TranscriptionLogs);

/// <summary>
/// Deletes web events and activity-log rows older than <see cref="TranscriptionLog.RetentionDays"/> days.
/// Run daily by the activity retention worker; payments are financial records and are not touched.
/// </summary>
public sealed record PurgeOldActivityCommand : IRequest<Result<PurgeOldActivityResult>>;

public sealed class PurgeOldActivityCommandHandler : IRequestHandler<PurgeOldActivityCommand, Result<PurgeOldActivityResult>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public PurgeOldActivityCommandHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<PurgeOldActivityResult>> Handle(PurgeOldActivityCommand request, CancellationToken ct)
    {
        var cutoff = _clock.UtcNow.AddDays(-TranscriptionLog.RetentionDays);
        var events = await _db.WebEvents.Where(e => e.OccurredAtUtc < cutoff).ExecuteDeleteAsync(ct);
        var logs = await _db.TranscriptionLogs.Where(l => l.CreatedAtUtc < cutoff).ExecuteDeleteAsync(ct);
        return new PurgeOldActivityResult(events, logs);
    }
}
