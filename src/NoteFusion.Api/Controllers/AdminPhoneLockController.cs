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
/// Opening Admin on the phone (board f-admin/10 revised). Set up once per phone with the password and an emailed code,
/// which gives the phone a key it keeps behind its fingerprint or face; after that the key opens a pass. A phone with no
/// such sensor opens with the password and an emailed code each time. Admins only, and reachable while locked.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[AllowLockedPhone]
[Route("api/admin/phone-lock")]
public sealed class AdminPhoneLockController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminPhoneLockController(ISender sender) => _sender = sender;

    /// <summary>
    /// The password, then a code to the account's inbox. <c>purpose</c> "setup" or "unlock". 422
    /// <c>ADMIN_PASSWORD_INCORRECT</c>, 403 <c>ADMIN_PASSWORD_LOCKED</c>, <c>ADMIN_CODE_LIMIT</c> or <c>ADMIN_LOCK_TOO_MANY</c>.
    /// </summary>
    [HttpPost("code")]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    public async Task<IActionResult> Code(AdminCodeRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new RequestAdminCodeCommand(body.Password, body.Purpose), ct));

    /// <summary>The setup code: this phone's key (its secret shown once) and an open pass.</summary>
    [HttpPost("keys")]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    public async Task<IActionResult> SetUp(SetUpAdminPhoneRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new SetUpAdminPhoneCommand(body.CodeId, body.Code, body.Label, body.ReplacesKeyId), ct));

    /// <summary>
    /// The phone's key, read with its fingerprint or face: an open pass, replacing the one sent (a destructive
    /// action's confirmation). 422 <c>ADMIN_PHONE_KEY_INVALID</c> means set the phone up again.
    /// </summary>
    [HttpPost("unlock")]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    public async Task<IActionResult> Unlock(UnlockAdminPhoneRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UnlockAdminPhoneCommand(body.KeyId, body.Secret, SessionOf(Request)), ct));

    /// <summary>A phone with no sensor: the unlock code opens a pass.</summary>
    [HttpPost("code/verify")]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    public async Task<IActionResult> Verify(VerifyAdminCodeRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new VerifyAdminCodeCommand(body.CodeId, body.Code), ct));

    /// <summary>The phone locked Admin: its pass ends now.</summary>
    [HttpPost("lock")]
    public async Task<IActionResult> Lock(CancellationToken ct)
        => HandleNoContent(await _sender.Send(new LockAdminPhoneCommand(SessionOf(Request)), ct));

    internal static string? SessionOf(HttpRequest request)
    {
        var value = request.Headers[AdminPhoneLockRules.Header].ToString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}

/// <summary>JSON body of <c>POST /api/admin/phone-lock/code</c>.</summary>
public sealed record AdminCodeRequest(string Password, string Purpose);

/// <summary>JSON body of <c>POST /api/admin/phone-lock/keys</c>.</summary>
public sealed record SetUpAdminPhoneRequest(string CodeId, string Code, string? Label, Guid? ReplacesKeyId);

/// <summary>JSON body of <c>POST /api/admin/phone-lock/unlock</c>.</summary>
public sealed record UnlockAdminPhoneRequest(Guid KeyId, string Secret);

/// <summary>JSON body of <c>POST /api/admin/phone-lock/code/verify</c>.</summary>
public sealed record VerifyAdminCodeRequest(string CodeId, string Code);
