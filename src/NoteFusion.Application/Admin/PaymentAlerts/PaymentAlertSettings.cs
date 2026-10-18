using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.PaymentAlerts;

/// <summary>
/// One admin phone's payment alerts (Admin › Payment alerts, board f-admin/09). <c>Registered</c> false: this phone's
/// push token is not registered to the caller (notifications are off on it), and the rest are the defaults.
/// </summary>
public sealed record PaymentAlertSettingsDto(
    bool Registered,
    bool On,
    string Sound,
    bool Vibrate,
    bool QuietAtNight,
    bool HideNames,
    bool Problems,
    DateTime? MutedUntilUtc);

/// <summary>What <c>POST /api/admin/alerts/test</c> did: the push service took the sample alert for this phone.</summary>
public sealed record TestPaymentAlertDto(bool Sent);

internal static class PaymentAlertDevice
{
    /// <summary>The caller's own registration of this push token; null when it is not theirs.</summary>
    public static Task<DeviceToken?> FindAsync(IApplicationDbContext db, Guid userId, string token, CancellationToken ct)
        => db.DeviceTokens.FirstOrDefaultAsync(t => t.UserId == userId && t.Token == token, ct);

    public static PaymentAlertSettingsDto ToDto(DeviceToken? d, DateTime utcNow) => d is null
        ? new PaymentAlertSettingsDto(false, false, PaymentAlertSounds.Chime, true, false, false, true, null)
        : new PaymentAlertSettingsDto(
            true, d.PaymentAlerts, d.PaymentAlertSound, d.PaymentAlertVibrate, d.PaymentAlertQuietAtNight,
            d.PaymentAlertHideNames, d.PaymentProblemAlerts,
            d.PaymentAlertsMutedUntilUtc > utcNow ? d.PaymentAlertsMutedUntilUtc : null);
}

public static class PaymentAlertErrors
{
    /// <summary>The token is not a phone registered to the caller: alerts can only be set on one's own phone.</summary>
    public static readonly Error DeviceUnknown = Error.NotFound(
        "ADMIN_ALERTS_DEVICE_UNKNOWN",
        "This phone is not registered for notifications. Turn notifications on in Profile › Notifications, then try again.");

    public static readonly Error TestNotSent = Error.Failure(
        "ADMIN_ALERTS_TEST_NOT_SENT",
        "The test alert could not be sent just now. Try again in a minute.");
}

// ── GET /api/admin/alerts/device?token= ─────────────────────────────────────────────────────────────────────────────

public sealed record GetPaymentAlertSettingsQuery(string Token) : IRequest<Result<PaymentAlertSettingsDto>>;

public sealed class GetPaymentAlertSettingsQueryHandler
    : IRequestHandler<GetPaymentAlertSettingsQuery, Result<PaymentAlertSettingsDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IDateTimeProvider _clock;

    public GetPaymentAlertSettingsQueryHandler(IApplicationDbContext db, ICurrentUser caller, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _clock = clock;
    }

    public async Task<Result<PaymentAlertSettingsDto>> Handle(GetPaymentAlertSettingsQuery request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;
        var device = string.IsNullOrWhiteSpace(request.Token)
            ? null
            : await PaymentAlertDevice.FindAsync(_db, userId, request.Token.Trim(), ct);
        return PaymentAlertDevice.ToDto(device, _clock.UtcNow);
    }
}

// ── PUT /api/admin/alerts/device ────────────────────────────────────────────────────────────────────────────────────

/// <summary>Sets this phone's payment alerts. Sent by app code that has created the matching channels.</summary>
public sealed record SetPaymentAlertSettingsCommand(
    string Token,
    bool On,
    string Sound,
    bool Vibrate,
    bool QuietAtNight,
    bool HideNames,
    bool Problems) : IRequest<Result<PaymentAlertSettingsDto>>;

public sealed class SetPaymentAlertSettingsCommandValidator : AbstractValidator<SetPaymentAlertSettingsCommand>
{
    public SetPaymentAlertSettingsCommandValidator()
    {
        RuleFor(x => x.Token).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Sound).Must(PaymentAlertSounds.IsKnown).WithMessage("Choose the chime, the phone's sound or no sound.");
    }
}

public sealed class SetPaymentAlertSettingsCommandHandler
    : IRequestHandler<SetPaymentAlertSettingsCommand, Result<PaymentAlertSettingsDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IDateTimeProvider _clock;

    public SetPaymentAlertSettingsCommandHandler(IApplicationDbContext db, ICurrentUser caller, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _clock = clock;
    }

    public async Task<Result<PaymentAlertSettingsDto>> Handle(SetPaymentAlertSettingsCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;
        if (!PaymentAlertSounds.IsKnown(request.Sound))
            return Error.Validation("ADMIN_ALERTS_SOUND_UNKNOWN", "Choose the chime, the phone's sound or no sound.");

        var device = await PaymentAlertDevice.FindAsync(_db, userId, request.Token.Trim(), ct);
        if (device is null)
            return PaymentAlertErrors.DeviceUnknown;

        var now = _clock.UtcNow;
        device.SetPaymentAlerts(
            request.On, request.Sound, request.Vibrate, request.QuietAtNight, request.HideNames, request.Problems, now);
        await _db.SaveChangesAsync(ct);
        return PaymentAlertDevice.ToDto(device, now);
    }
}

// ── POST /api/admin/alerts/device/mute ──────────────────────────────────────────────────────────────────────────────

/// <summary>"Mute 1 hour" (the notification's action): <c>Minutes</c> 1–1440, or 0 to unmute.</summary>
public sealed record MutePaymentAlertsCommand(string Token, int Minutes) : IRequest<Result<PaymentAlertSettingsDto>>;

public sealed class MutePaymentAlertsCommandValidator : AbstractValidator<MutePaymentAlertsCommand>
{
    public MutePaymentAlertsCommandValidator()
    {
        RuleFor(x => x.Token).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Minutes).InclusiveBetween(0, 1440);
    }
}

public sealed class MutePaymentAlertsCommandHandler
    : IRequestHandler<MutePaymentAlertsCommand, Result<PaymentAlertSettingsDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IDateTimeProvider _clock;

    public MutePaymentAlertsCommandHandler(IApplicationDbContext db, ICurrentUser caller, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _clock = clock;
    }

    public async Task<Result<PaymentAlertSettingsDto>> Handle(MutePaymentAlertsCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        var device = await PaymentAlertDevice.FindAsync(_db, userId, request.Token.Trim(), ct);
        if (device is null)
            return PaymentAlertErrors.DeviceUnknown;

        var now = _clock.UtcNow;
        var minutes = Math.Clamp(request.Minutes, 0, 1440);
        device.MutePaymentAlerts(minutes == 0 ? null : now.AddMinutes(minutes), now);
        await _db.SaveChangesAsync(ct);
        return PaymentAlertDevice.ToDto(device, now);
    }
}

// ── POST /api/admin/alerts/test ─────────────────────────────────────────────────────────────────────────────────────

/// <summary>"Send a test alert": a sample payment push to this phone alone, ringing as a real one would now.</summary>
public sealed record SendTestPaymentAlertCommand(string Token) : IRequest<Result<TestPaymentAlertDto>>;

public sealed class SendTestPaymentAlertCommandHandler
    : IRequestHandler<SendTestPaymentAlertCommand, Result<TestPaymentAlertDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IPushSender _push;
    private readonly IDateTimeProvider _clock;

    public SendTestPaymentAlertCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IPushSender push, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _push = push;
        _clock = clock;
    }

    public async Task<Result<TestPaymentAlertDto>> Handle(SendTestPaymentAlertCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        var token = request.Token?.Trim() ?? "";
        // The same set the real alerts go to (an admin in the database, a token no other account holds), narrowed to
        // the caller's own phone.
        var device = (await AdminAlertDevices.ReadAsync(
                AdminAlertDevices.Query(_db).Where(t => t.UserId == userId && t.Token == token), _db, ct))
            .FirstOrDefault();
        if (device is null)
            return PaymentAlertErrors.DeviceUnknown;

        var now = _clock.UtcNow;
        var (channel, sound) = PaymentAlertChannels.For(
            device.Sound, device.Vibrate, device.QuietAtNight, device.MutedUntilUtc, device.TimeZone, now);
        var words = PaymentPushCopy.Test();

        var delivery = await _push.SendToDevicesAsync(
            [device.Token],
            new PushMessage(
                words.Title, words.Body, new Dictionary<string, string> { ["screen"] = "AdminPayments" },
                sound, channel, PaymentAlertChannels.TimeToLiveSeconds, PaymentAlertChannels.Category),
            ct);

        return delivery.Delivered && delivery.Accepted > 0
            ? new TestPaymentAlertDto(true)
            : PaymentAlertErrors.TestNotSent;
    }
}
