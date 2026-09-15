using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

public sealed record SetSystemAnnouncementCommand(
    string Message,
    string Severity = "info",
    DateTime? ExpiresAtUtc = null,
    string? Note = null) : IRequest<Result<SystemAnnouncementDto>>;

public sealed class SetSystemAnnouncementCommandHandler
    : IRequestHandler<SetSystemAnnouncementCommand, Result<SystemAnnouncementDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public SetSystemAnnouncementCommandHandler(
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

    public async Task<Result<SystemAnnouncementDto>> Handle(
        SetSystemAnnouncementCommand request, CancellationToken ct)
    {
        var now = _clock.UtcNow;

        // Deactivate any existing active announcements
        var activeExisting = await _db.SystemAnnouncements
            .Where(a => a.IsActive)
            .ToListAsync(ct);

        foreach (var existing in activeExisting)
        {
            existing.Deactivate(now);
        }

        var announcement = SystemAnnouncement.Create(
            request.Message,
            request.Severity,
            request.ExpiresAtUtc,
            now);

        _db.SystemAnnouncements.Add(announcement);

        _audit.Record(
            AdminAuditAction.SetAnnouncement,
            null,
            $"Published announcement: \"{request.Message}\" (severity: {request.Severity}).",
            request.Note);

        await _db.SaveChangesAsync(ct);

        return Result.Success(new SystemAnnouncementDto(
            announcement.Id,
            announcement.Message,
            announcement.Severity,
            announcement.IsActive,
            announcement.ExpiresAtUtc,
            announcement.CreatedAtUtc,
            announcement.UpdatedAtUtc));
    }
}
