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

    /// <summary>
    /// Creates an account and emails a six-digit code. Returns the address, not a token pair —
    /// <see cref="VerifyEmail"/> is what issues the session.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Confirms an address with the emailed code and returns the token pair registration withheld.
    /// 400 with <c>AUTH_INVALID_VERIFICATION_CODE</c> when the code is wrong, expired or used up.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("verify-email")]
    public async Task<IActionResult> VerifyEmail(VerifyEmailCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Emails a fresh verification code. Always returns 204 — whether the address is registered, already
    /// verified, or asking again too soon is not the caller's to know.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("resend-verification")]
    public async Task<IActionResult> ResendVerification(
        ResendEmailVerificationCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));

    /// <summary>
    /// Authenticates and returns a token pair. 403 with <c>AUTH_EMAIL_NOT_VERIFIED</c> when the password
    /// was correct but the address was never confirmed; a fresh code has been sent by then.
    /// </summary>
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

    /// <summary>
    /// Initiates a password reset by emailing a one-time link. Always returns 204 regardless
    /// of whether the address belongs to a registered account.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));

    /// <summary>
    /// Completes the password-reset flow: verifies the token and sets the new password.
    /// Returns 204 on success; 400 when the token is invalid or expired.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetPasswordCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));
}
