using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Admin.PaymentAlerts;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Admin › Payment alerts on the phone (board f-admin/09): how this phone wants the "someone just paid" push, a mute,
/// and a test alert. Each acts on the caller's own registration of the push token it names, never another account's.
/// Behind the Admin policy like every admin route, which reads the role from the account row on each request.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/alerts")]
public sealed class AdminAlertsController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminAlertsController(ISender sender) => _sender = sender;

    /// <summary>This phone's payment alerts; <c>registered</c> false when its token is not the caller's.</summary>
    [HttpGet("device")]
    public async Task<IActionResult> GetDevice([FromQuery] string? token, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetPaymentAlertSettingsQuery(token ?? ""), ct));

    /// <summary>
    /// Sets them: <c>on</c>, <c>sound</c> ("chime" | "phone" | "none"), <c>vibrate</c>, <c>quietAtNight</c>,
    /// <c>hideNames</c>, <c>problems</c>. 404 <c>ADMIN_ALERTS_DEVICE_UNKNOWN</c> for a token not registered to the caller.
    /// </summary>
    [HttpPut("device")]
    public async Task<IActionResult> SetDevice(SetPaymentAlertsRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new SetPaymentAlertSettingsCommand(
            body.Token, body.On, body.Sound, body.Vibrate, body.QuietAtNight, body.HideNames, body.Problems), ct));

    /// <summary>"Mute 1 hour": <c>minutes</c> 1–1440 of alerts without a sound, or 0 to unmute.</summary>
    [HttpPost("device/mute")]
    public async Task<IActionResult> Mute(MutePaymentAlertsRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new MutePaymentAlertsCommand(body.Token, body.Minutes), ct));

    /// <summary>"Send a test alert": a sample payment push to this phone alone.</summary>
    [HttpPost("test")]
    public async Task<IActionResult> Test(TestPaymentAlertRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new SendTestPaymentAlertCommand(body.Token), ct));
}

/// <summary>
/// The phone admin's lock (board f-admin/10). The phone asks for a fingerprint, face or the phone's own PIN; on a
/// phone with none of those the admin types their account password, checked here. Admin-only like every admin route.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/lock")]
public sealed class AdminLockController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminLockController(ISender sender) => _sender = sender;

    /// <summary>
    /// 204 when <c>password</c> is the caller's own; 422 <c>ADMIN_PASSWORD_INCORRECT</c> when not (it counts towards the
    /// sign-in lockout), 422 <c>ADMIN_PASSWORD_NOT_SET</c> for a Google-only account, 403 <c>ADMIN_PASSWORD_LOCKED</c>.
    /// </summary>
    [HttpPost("password")]
    public async Task<IActionResult> Password(ConfirmAdminPasswordRequest body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new ConfirmAdminPasswordCommand(body.Password), ct));
}

/// <summary>JSON body of <c>POST /api/admin/lock/password</c>.</summary>
public sealed record ConfirmAdminPasswordRequest(string Password);

/// <summary>JSON body of <c>PUT /api/admin/alerts/device</c>.</summary>
public sealed record SetPaymentAlertsRequest(
    string Token, bool On, string Sound, bool Vibrate, bool QuietAtNight, bool HideNames, bool Problems);

/// <summary>JSON body of <c>POST /api/admin/alerts/device/mute</c>.</summary>
public sealed record MutePaymentAlertsRequest(string Token, int Minutes);

/// <summary>JSON body of <c>POST /api/admin/alerts/test</c>.</summary>
public sealed record TestPaymentAlertRequest(string Token);
