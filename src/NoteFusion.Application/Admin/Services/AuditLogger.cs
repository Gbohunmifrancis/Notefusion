using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Admin.Services;

/// <summary>
/// Default <see cref="IAuditLogger"/>: reads the actor from the validated JWT, the address from the
/// request, the time from the clock, and stages the row on the same context as the change it describes.
/// </summary>
public sealed class AuditLogger : IAuditLogger
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IClientIpAddress _clientIp;
    private readonly IDateTimeProvider _clock;

    public AuditLogger(
        IApplicationDbContext db, ICurrentUser currentUser, IClientIpAddress clientIp, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clientIp = clientIp;
        _clock = clock;
    }

    public AdminAuditLog Record(AdminAuditAction action, User? target, string summary, string? note = null)
    {
        // Every caller sits behind the Admin policy, so an anonymous one is a wiring mistake rather than
        // a runtime condition — and writing a trail entry with no actor would defeat the point of it.
        if (_currentUser.UserId is not { } actorId)
            throw new InvalidOperationException("The audit trail cannot be written outside an authenticated request.");

        var entry = AdminAuditLog.Record(
            actorId,
            // The email claim is always minted with our tokens; the id keeps the row readable if a token
            // ever arrives without it, which beats throwing away the whole record over a display string.
            _currentUser.Email ?? $"user:{actorId}",
            action,
            target?.Id,
            target?.Email,
            _clientIp.Current,
            summary,
            note,
            _clock.UtcNow);

        _db.AdminAuditLogs.Add(entry);
        return entry;
    }
}
