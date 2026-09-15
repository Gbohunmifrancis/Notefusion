using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

public sealed record GetSystemAnnouncementQuery : IRequest<Result<SystemAnnouncementDto?>>;

public sealed class GetSystemAnnouncementQueryHandler
    : IRequestHandler<GetSystemAnnouncementQuery, Result<SystemAnnouncementDto?>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetSystemAnnouncementQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<SystemAnnouncementDto?>> Handle(
        GetSystemAnnouncementQuery request, CancellationToken ct)
    {
        var now = _clock.UtcNow;

        var announcement = await _db.SystemAnnouncements
            .AsNoTracking()
            .Where(a => a.IsActive && (a.ExpiresAtUtc == null || a.ExpiresAtUtc > now))
            .OrderByDescending(a => a.CreatedAtUtc)
            .Select(a => new SystemAnnouncementDto(
                a.Id,
                a.Message,
                a.Severity,
                a.IsActive,
                a.ExpiresAtUtc,
                a.CreatedAtUtc,
                a.UpdatedAtUtc))
            .FirstOrDefaultAsync(ct);

        return Result.Success(announcement);
    }
}
