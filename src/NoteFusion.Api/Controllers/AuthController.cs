using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Auth.Commands;

namespace NoteFusion.Api.Controllers;

/// <summary>Authentication endpoints: register, login, refresh, logout, change password.</summary>
public sealed class AuthController : ApiControllerBase
{
    private readonly ISender _sender;

    public AuthController(ISender sender) => _sender = sender;

    /// <summary>Creates an account and returns a token pair.</summary>
    [AllowAnonymous]
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>Authenticates and returns a token pair.</summary>
    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Signs in with a Google ID token, creating the account on first use.
    /// Serves both sign-up and sign-in — the client cannot tell them apart.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("google")]
    public async Task<IActionResult> Google(GoogleSignInCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>Rotates the refresh token and issues a fresh access token.</summary>
    [AllowAnonymous]
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh(RefreshTokenCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>Revokes a refresh token.</summary>
    [AllowAnonymous]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(LogoutCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));

    /// <summary>Changes the current user's password and returns a fresh token pair.</summary>
    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));
}
