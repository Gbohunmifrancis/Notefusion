using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Admin.PhoneLock;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Opening the admin console (board i-console-lock): one of the admin's passkeys, or the password on a computer with
/// none, opens a pass sent back as <c>X-Admin-Session</c> on every admin call. Locks after 5 minutes away; each unlock
/// is also the fresh confirmation the destructive actions want. Admins only, and reachable while locked.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[AllowLockedPhone]
[Route("api/admin/console-lock")]
public sealed class AdminConsoleLockController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminConsoleLockController(ISender sender) => _sender = sender;

    /// <summary>Assertion options for unlocking with a passkey (the same shape as a passkey sign-in's).</summary>
    [HttpPost("passkey/options")]
    [EnableRateLimiting(AuthRateLimiting.Passkeys)]
    public async Task<IActionResult> PasskeyOptions(CancellationToken ct)
        => HandleResult(await _sender.Send(new BeginConsoleUnlockCommand(), ct));

    /// <summary><c>{ credential }</c>, made with one of the caller's passkeys: an open pass, replacing the one sent.</summary>
    [HttpPost("passkey")]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    public async Task<IActionResult> Passkey(PasskeyLoginRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(
            new UnlockConsoleWithPasskeyCommand(body.Credential, AdminPhoneLockController.SessionOf(Request)), ct));

    /// <summary>
    /// <c>{ password }</c>: an open pass, replacing the one sent. 422 <c>ADMIN_PASSWORD_INCORRECT</c> or
    /// <c>ADMIN_PASSWORD_NOT_SET</c> (a Google-only account), 403 <c>ADMIN_PASSWORD_LOCKED</c>.
    /// </summary>
    [HttpPost("password")]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    public async Task<IActionResult> Password(ConsoleUnlockPasswordRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(
            new UnlockConsoleWithPasswordCommand(body.Password ?? string.Empty, AdminPhoneLockController.SessionOf(Request)), ct));

    /// <summary>
    /// Remembers this browser (<c>AdminTrustedBrowser</c>): <c>{ token, expiresAtUtc }</c>, kept by the console and traded
    /// for a pass at <c>trusted</c>. Wants a pass opened in the last minute (an unlock or a sign-in), else 403.
    /// </summary>
    [HttpPost("trust")]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    public async Task<IActionResult> Trust(CancellationToken ct)
    {
        var agent = NoteFusion.Application.Web.UserAgentFamily.Read(Request.Headers.UserAgent.ToString());
        var label = agent.Browser is null ? null : $"{agent.Browser} on {agent.Os}";
        return HandleResult(await _sender.Send(new RememberConsoleBrowserCommand(AdminPhoneLockController.SessionOf(Request), label), ct));
    }

    /// <summary>
    /// <c>{ token }</c> of a remembered browser: an open pass, replacing the one sent, that is not a fresh confirmation.
    /// 403 <c>ADMIN_TRUST_INVALID</c> when the browser was forgotten, has expired or is another admin's.
    /// </summary>
    [HttpPost("trusted")]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    public async Task<IActionResult> Trusted(ConsoleTrustRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(
            new OpenConsoleFromTrustedBrowserCommand(body.Token, AdminPhoneLockController.SessionOf(Request)), ct));

    /// <summary>Forgets this browser (<c>{ token }</c>, sent at sign-out); 204 whether or not it was remembered.</summary>
    [HttpPost("trust/forget")]
    public async Task<IActionResult> Forget(ConsoleTrustRequest body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new ForgetConsoleBrowserCommand(Token: body.Token), ct));

    /// <summary>The admin's remembered browsers for Settings; <c>{ token }</c> marks this one.</summary>
    [HttpPost("browsers")]
    public async Task<IActionResult> Browsers(ConsoleTrustRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetConsoleBrowsersQuery(body.Token), ct));

    /// <summary>Forgets one remembered browser from Settings.</summary>
    [HttpDelete("browsers/{id:guid}")]
    public async Task<IActionResult> ForgetById(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new ForgetConsoleBrowserCommand(Id: id), ct));

    /// <summary>The console locked (5 minutes away, signing out): its pass ends now.</summary>
    [HttpPost("lock")]
    public async Task<IActionResult> Lock(CancellationToken ct)
        => HandleNoContent(await _sender.Send(new LockAdminPhoneCommand(AdminPhoneLockController.SessionOf(Request)), ct));
}

/// <summary>JSON body carrying a remembered browser's token.</summary>
public sealed record ConsoleTrustRequest(string? Token);

/// <summary>JSON body of <c>POST /api/admin/console-lock/password</c>.</summary>
public sealed record ConsoleUnlockPasswordRequest(string? Password);
