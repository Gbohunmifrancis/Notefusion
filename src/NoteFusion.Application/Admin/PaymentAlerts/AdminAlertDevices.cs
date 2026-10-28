using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Admin.PaymentAlerts;

/// <summary>One admin phone and how it wants payment alerts, read at send time.</summary>
public sealed record AdminAlertDevice(
    Guid UserId,
    string Token,
    string Sound,
    bool Vibrate,
    bool QuietAtNight,
    bool HideNames,
    bool Problems,
    DateTime? MutedUntilUtc,
    DateTime? SetAtUtc,
    string? TimeZone,
    /// <summary>Which payment channels the phone's code made (<see cref="DeviceToken.PaymentChannelVersion"/>).</summary>
    int ChannelVersion = 1);

/// <summary>
/// The phones an admin alert may go to. The role is read from the account row now, never a token's claim, so an admin
/// demoted or suspended a moment ago is no longer told; and a push token another account has also registered (a phone
/// handed on before its old registration was dropped) is left out, so a customer's phone is never told who paid.
/// </summary>
public static class AdminAlertDevices
{
    public static IQueryable<DeviceToken> Query(IApplicationDbContext db)
        => db.DeviceTokens.Where(t =>
            db.Users.Any(u => u.Id == t.UserId && u.Role == UserRole.Admin && u.IsActive)
            && t.Platform != "web"
            && !db.DeviceTokens.Any(o => o.Token == t.Token && o.UserId != t.UserId));

    public static Task<List<AdminAlertDevice>> ReadAsync(IQueryable<DeviceToken> devices, IApplicationDbContext db, CancellationToken ct)
        => devices
            .Select(t => new AdminAlertDevice(
                t.UserId,
                t.Token,
                t.PaymentAlertSound,
                t.PaymentAlertVibrate,
                t.PaymentAlertQuietAtNight,
                t.PaymentAlertHideNames,
                t.PaymentProblemAlerts,
                t.PaymentAlertsMutedUntilUtc,
                t.PaymentAlertsSetAtUtc,
                db.Users.Where(u => u.Id == t.UserId).Select(u => u.TimeZone).FirstOrDefault(),
                t.PaymentChannelVersion))
            .ToListAsync(ct);

    /// <summary>Admin phones with "Alert me when someone pays" on.</summary>
    public static Task<List<AdminAlertDevice>> PaymentAlertsAsync(IApplicationDbContext db, CancellationToken ct)
        => ReadAsync(Query(db).Where(t => t.PaymentAlerts), db, ct);

    /// <summary>Admin phones with "Payment problems too" on (every admin phone, until one says otherwise).</summary>
    public static Task<List<AdminAlertDevice>> ProblemAlertsAsync(IApplicationDbContext db, CancellationToken ct)
        => ReadAsync(Query(db).Where(t => t.PaymentProblemAlerts), db, ct);
}
