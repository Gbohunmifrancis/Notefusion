using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Admin.PaymentAlerts;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.ActivityAlerts;

/// <summary>What one run of the activity push did.</summary>
public sealed record AdminActivityRun(int Signups, int Transcriptions, int Devices, int Accepted, string? Error)
{
    public static readonly AdminActivityRun Nothing = new(0, 0, 0, 0, null);
}

/// <summary>
/// Tells the admins' phones that someone just signed up or started a transcription: one push per run, or one summary
/// for several. Accounts and jobs created in (<paramref name="AfterUtc"/>, <paramref name="UntilUtc"/>]; the worker keeps
/// the window moving, so each is told once. Admins' own sign-ups and transcriptions are left out.
/// </summary>
/// <remarks>
/// Every admin phone (<see cref="AdminAlertDevices"/>: the role read from the database, a token no other account holds),
/// on the app's own "New users and transcriptions" channel, silent and still on the quiet channel while the phone is
/// muted or in its quiet hours, and without names when it asked for that. Best-effort: a push the service refused is
/// not tried again, since Overview and Users list everyone anyway.
/// </remarks>
public sealed record SendAdminActivityAlertsCommand(DateTime AfterUtc, DateTime UntilUtc) : IRequest<Result<AdminActivityRun>>
{
    /// <summary>The Android channel the app makes on admin phones (mobile <c>lib/paymentAlertsRuntime</c>).</summary>
    public const string Channel = "admin-activity";

    /// <summary>How long Expo may hold it for a phone that is off: an hour-old sign-up is still news.</summary>
    public const int TimeToLiveSeconds = 3600;

    /// <summary>At most this many of each in one run: a summary names three people anyway.</summary>
    public const int MaxPerRun = 200;
}

public sealed class SendAdminActivityAlertsCommandHandler
    : IRequestHandler<SendAdminActivityAlertsCommand, Result<AdminActivityRun>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPushSender _push;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<SendAdminActivityAlertsCommandHandler> _logger;

    public SendAdminActivityAlertsCommandHandler(
        IApplicationDbContext db, IPushSender push, IDateTimeProvider clock,
        ILogger<SendAdminActivityAlertsCommandHandler> logger)
    {
        _db = db;
        _push = push;
        _clock = clock;
        _logger = logger;
    }

    public async Task<Result<AdminActivityRun>> Handle(SendAdminActivityAlertsCommand request, CancellationToken ct)
    {
        var (after, until) = (request.AfterUtc, request.UntilUtc);

        var signups = await _db.Users
            .AsNoTracking()
            .Where(u => u.CreatedAt > after && u.CreatedAt <= until && u.Role != UserRole.Admin)
            .OrderBy(u => u.CreatedAt)
            .Take(SendAdminActivityAlertsCommand.MaxPerRun)
            .Select(u => new SignupFact(u.Id, u.FullName, u.SignupSource, u.Country))
            .ToListAsync(ct);

        var transcriptions = await _db.TranscriptionJobs
            .AsNoTracking()
            .Where(j => j.CreatedAtUtc > after && j.CreatedAtUtc <= until
                        && _db.Users.Any(u => u.Id == j.UserId && u.Role != UserRole.Admin))
            .OrderBy(j => j.CreatedAtUtc)
            .Take(SendAdminActivityAlertsCommand.MaxPerRun)
            .Select(j => new TranscriptionFact(
                j.UserId,
                _db.Users.Where(u => u.Id == j.UserId).Select(u => u.FullName).FirstOrDefault(),
                j.Kind,
                !_db.TranscriptionJobs.Any(o => o.UserId == j.UserId && o.CreatedAtUtc < j.CreatedAtUtc)))
            .ToListAsync(ct);

        if (signups.Count == 0 && transcriptions.Count == 0)
            return AdminActivityRun.Nothing;

        var devices = await AdminAlertDevices.ReadAsync(AdminAlertDevices.Query(_db), _db, ct);
        if (devices.Count == 0)
            return new AdminActivityRun(signups.Count, transcriptions.Count, 0, 0, null);

        var now = _clock.UtcNow;
        var people = signups.Select(s => s.UserId).Concat(transcriptions.Select(t => t.UserId)).Distinct().ToList();
        var data = people.Count == 1
            ? new Dictionary<string, string> { ["screen"] = "AdminUser", ["userId"] = people[0].ToString() }
            : new Dictionary<string, string> { ["screen"] = "AdminUsers" };

        int accepted = 0;
        string? error = null;
        foreach (var group in devices
                     .Select(d => (Device: d, Hushed: PaymentAlertChannels.For(
                         d.Sound, d.Vibrate, d.QuietAtNight, d.MutedUntilUtc, d.TimeZone, now).Channel == PaymentAlertChannels.Quiet))
                     .GroupBy(x => (x.Hushed, x.Device.HideNames)))
        {
            var words = AdminActivityPushCopy.Summary(signups, transcriptions, group.Key.HideNames);
            var delivery = await _push.SendToDevicesAsync(
                group.Select(x => x.Device.Token).ToList(),
                new PushMessage(
                    words.Title, words.Body, data,
                    Sound: group.Key.Hushed ? null : "default",
                    ChannelId: group.Key.Hushed ? PaymentAlertChannels.Quiet : SendAdminActivityAlertsCommand.Channel,
                    TimeToLiveSeconds: SendAdminActivityAlertsCommand.TimeToLiveSeconds),
                ct);
            accepted += delivery.Accepted;
            if (!delivery.Delivered)
                error ??= delivery.Error;
        }

        if (accepted == 0 && error is not null)
            _logger.LogWarning(
                "Activity push ({Signups} sign-up(s), {Transcriptions} transcription(s)) not delivered: {Error}",
                signups.Count, transcriptions.Count, error);

        return new AdminActivityRun(signups.Count, transcriptions.Count, devices.Count, accepted, accepted == 0 ? error : null);
    }
}
