using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Controllers;

/// <summary>Authentication endpoints: register, login, refresh, logout, change password.</summary>
/// <remarks>
/// Every anonymous route here is rate limited per caller address — see <see cref="AuthRateLimiting"/> for
/// which limit is which and why. Rejections come back as 429 with the usual <c>{code, message}</c> envelope
/// and a <c>Retry-After</c> header, so a client can wait the stated time rather than guess.
/// </remarks>
public sealed class AuthController : ApiControllerBase
{
    private readonly ISender _sender;
    private readonly IAdminPhoneLock _passes;
    private readonly IClientApp _client;
    private readonly IDateTimeProvider _clock;

    public AuthController(ISender sender, IAdminPhoneLock passes, IClientApp client, IDateTimeProvider clock)
    {
        _sender = sender;
        _passes = passes;
        _client = client;
        _clock = clock;
    }

    /// <summary>
    /// Creates an account and emails a six-digit code. Returns the address, not a token pair —
    /// <see cref="VerifyEmail"/> is what issues the session.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.Registration)]
    [HttpPost("register")]
    [NoActivity]
    public async Task<IActionResult> Register(RegisterCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Confirms an address with the emailed code and returns the token pair registration withheld.
    /// 400 with <c>AUTH_INVALID_VERIFICATION_CODE</c> when the code is wrong, expired or used up.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    [HttpPost("verify-email")]
    [NoActivity]
    public async Task<IActionResult> VerifyEmail(VerifyEmailCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Emails a fresh verification code. Always returns 204 — whether the address is registered, already
    /// verified, or asking again too soon is not the caller's to know.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.EmailDispatch)]
    [HttpPost("resend-verification")]
    [NoActivity]
    public async Task<IActionResult> ResendVerification(
        ResendEmailVerificationCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));

    /// <summary>
    /// Authenticates and returns a token pair. 403 with <c>AUTH_EMAIL_NOT_VERIFIED</c> when the password
    /// was correct but the address was never confirmed; a fresh code has been sent by then.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    [HttpPost("login")]
    [NoActivity]
    public async Task<IActionResult> Login(LoginCommand command, CancellationToken ct)
    {
        var result = await _sender.Send(command, ct);
        if (result.IsSuccess)
            AdminConsolePass.Attach(HttpContext, result.Value, _passes, _client, _clock);
        return HandleResult(result);
    }

    /// <summary>
    /// Signs in with a Google ID token, creating the account on first use.
    /// Serves both sign-up and sign-in — the client cannot tell them apart.
    /// </summary>
    /// <remarks>
    /// Limited as registration, not as credentials: there is no secret to guess here — an ID token either
    /// verifies against Google's keys or it does not — but this route mints accounts, and a free grant per
    /// account is the thing worth farming.
    /// </remarks>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.Registration)]
    [HttpPost("google")]
    [NoActivity]
    public async Task<IActionResult> Google(GoogleSignInCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>Rotates the refresh token and issues a fresh access token.</summary>
    /// <remarks>
    /// Limited, but loosely and on its own bucket (<see cref="AuthRateLimiting.TokenRefresh"/>). Every
    /// signed-in client calls this on a schedule and again on any 401, so a limit as tight as login's would
    /// sign real users out of their own session; the token is long random material brute force does not
    /// reach, so the limit is there to cap the bcrypt work an anonymous caller can make us do. Rotation is
    /// the main control: a token is spent once, and a spent one coming back revokes the user's others.
    /// </remarks>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.TokenRefresh)]
    [HttpPost("refresh")]
    [NoActivity]
    public async Task<IActionResult> Refresh(RefreshTokenCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>Revokes a refresh token.</summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.TokenRefresh)]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(LogoutCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));

    /// <summary>Changes the current user's password and returns a fresh token pair.</summary>
    [Authorize]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Initiates a password reset by emailing a one-time link. Always returns 204 regardless
    /// of whether the address belongs to a registered account.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.EmailDispatch)]
    [HttpPost("forgot-password")]
    [NoActivity]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));

    /// <summary>
    /// Completes the password-reset flow: verifies the token and sets the new password.
    /// Returns 204 on success; 400 when the token is invalid or expired.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    [HttpPost("reset-password")]
    [NoActivity]
    public async Task<IActionResult> ResetPassword(ResetPasswordCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));
}
