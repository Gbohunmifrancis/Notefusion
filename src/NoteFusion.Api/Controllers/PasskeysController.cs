using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Auth.Passkeys;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Passkeys (WebAuthn) for the admin console: an admin adds, lists, renames and removes their own, and
/// signs in with one instead of the password.
/// </summary>
/// <remarks>
/// Options go out and responses come in as WebAuthn JSON (the browser's own shapes, base64url bytes), not
/// camel-cased DTOs. The sign-in itself is limited as credentials, like password login; minting options
/// and storing a passkey guess at nothing and sit on their own looser bucket (<see cref="AuthRateLimiting.Passkeys"/>),
/// because the sign-in page asks for options on every load.
/// </remarks>
[Route("api/auth/passkeys")]
public sealed class PasskeysController : ApiControllerBase
{
    private readonly ISender _sender;

    public PasskeysController(ISender sender) => _sender = sender;

    /// <summary>Creation options for adding a passkey to the signed-in admin's account.</summary>
    [Authorize(Policy = AuthorizationPolicies.Admin)]
    [EnableRateLimiting(AuthRateLimiting.Passkeys)]
    [HttpPost("register/options")]
    public async Task<IActionResult> RegisterOptions(CancellationToken ct)
        => HandleResult(await _sender.Send(new BeginPasskeyRegistrationCommand(), ct));

    /// <summary>
    /// Stores the passkey the browser just created: <c>{ credential, name }</c>, where <c>credential</c> is
    /// the PublicKeyCredential as JSON. Returns the stored passkey.
    /// </summary>
    [Authorize(Policy = AuthorizationPolicies.Admin)]
    [EnableRateLimiting(AuthRateLimiting.Passkeys)]
    [HttpPost("register")]
    public async Task<IActionResult> Register(CompletePasskeyRegistrationCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>The signed-in admin's passkeys, newest first.</summary>
    [Authorize(Policy = AuthorizationPolicies.Admin)]
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetMyPasskeysQuery(), ct));

    /// <summary>Renames one of the caller's passkeys. 404 for one that is not theirs.</summary>
    [Authorize(Policy = AuthorizationPolicies.Admin)]
    [HttpPatch("{id:guid}")]
    public async Task<IActionResult> Rename(Guid id, RenamePasskeyRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new RenamePasskeyCommand(id, body.Name ?? string.Empty), ct));

    /// <summary>Removes one of the caller's passkeys. 404 for one that is not theirs.</summary>
    [Authorize(Policy = AuthorizationPolicies.Admin)]
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new DeletePasskeyCommand(id), ct));

    /// <summary>Assertion options for a passkey sign-in (discoverable: no email needed).</summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.Passkeys)]
    [HttpPost("login/options")]
    public async Task<IActionResult> LoginOptions(CancellationToken ct)
        => HandleResult(await _sender.Send(new BeginPasskeySignInCommand(), ct));

    /// <summary>
    /// Signs in with a passkey: <c>{ credential }</c>. Returns the same token pair as password login, for an
    /// admin account only (403 <c>PASSKEY_NOT_ADMIN</c> otherwise).
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    [HttpPost("login")]
    public async Task<IActionResult> Login(PasskeyLoginRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new PasskeySignInCommand(body.Credential), ct));
}

/// <summary>Body of <c>PATCH /api/auth/passkeys/{id}</c>.</summary>
public sealed record RenamePasskeyRequest(string? Name);

/// <summary>Body of <c>POST /api/auth/passkeys/login</c>.</summary>
public sealed record PasskeyLoginRequest(JsonElement Credential);
