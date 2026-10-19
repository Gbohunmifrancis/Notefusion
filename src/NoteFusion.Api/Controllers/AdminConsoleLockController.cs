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

    /// <summary>The console locked (5 minutes away, signing out): its pass ends now.</summary>
    [HttpPost("lock")]
    public async Task<IActionResult> Lock(CancellationToken ct)
        => HandleNoContent(await _sender.Send(new LockAdminPhoneCommand(AdminPhoneLockController.SessionOf(Request)), ct));
}

/// <summary>JSON body of <c>POST /api/admin/console-lock/password</c>.</summary>
public sealed record ConsoleUnlockPasswordRequest(string? Password);
