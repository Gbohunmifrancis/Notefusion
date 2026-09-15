using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

public sealed record ClearSystemAnnouncementCommand(string? Note = null) : IRequest<Result>;

public sealed class ClearSystemAnnouncementCommandHandler : IRequestHandler<ClearSystemAnnouncementCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public ClearSystemAnnouncementCommandHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IAuditLogger audit,
        IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _clock = clock;
    }

    public async Task<Result> Handle(ClearSystemAnnouncementCommand request, CancellationToken ct)
    {
        var now = _clock.UtcNow;

        var active = await _db.SystemAnnouncements
            .Where(a => a.IsActive)
            .ToListAsync(ct);

        if (active.Count == 0)
            return Result.Success();

        foreach (var item in active)
        {
            item.Deactivate(now);
        }

        _audit.Record(
            AdminAuditAction.SetAnnouncement,
            null,
            "Cleared active system announcement.",
            request.Note);

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
