using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

/// <summary>
/// Initiates a password-reset flow for the supplied email. Deliberately never discloses whether
/// an account with that email exists — callers always receive a 204 so a probe cannot enumerate
/// registered addresses.
/// </summary>
/// <remarks>
/// The link's destination is <b>not</b> a parameter. It used to be, and that made this endpoint — which is
/// anonymous by design — a way to have NoteFusion email a genuine one-time reset token to a URL of the
/// caller's choosing: post someone else's address with your own base URL and the account owner receives a
/// real-looking reset link pointing at your site. The destination now comes from
/// <see cref="AuthSettings.ResetPasswordUrl"/>, which only a deploy can set.
/// </remarks>
public sealed record ForgotPasswordCommand(string Email) : IRequest<Result<Unit>>;

public sealed class ForgotPasswordCommandValidator : AbstractValidator<ForgotPasswordCommand>
{
    public ForgotPasswordCommandValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);
    }
}

public sealed class ForgotPasswordCommandHandler : IRequestHandler<ForgotPasswordCommand, Result<Unit>>
{
    private readonly IApplicationDbContext _db;
    private readonly ISecureTokenGenerator _tokenGen;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;
    private readonly AuthSettings _auth;
    private readonly ILogger<ForgotPasswordCommandHandler> _logger;

    public ForgotPasswordCommandHandler(
        IApplicationDbContext db, ISecureTokenGenerator tokenGen, IDateTimeProvider clock,
        IEmailSender email, AuthSettings auth, ILogger<ForgotPasswordCommandHandler> logger)
    {
        _db = db;
        _tokenGen = tokenGen;
        _clock = clock;
        _email = email;
        _auth = auth;
        _logger = logger;
    }

    public async Task<Result<Unit>> Handle(ForgotPasswordCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);

        // Do not reveal whether the email is registered. Log at debug so the absence is still
        // observable during development without leaking it to the client.
        if (user is null)
        {
            _logger.LogDebug("Forgot-password request for unknown email {Email} — silently ignored.", normalizedEmail);
            return Unit.Value;
        }

        // A link sent moments ago stands: replacing it on every request would let anyone who knows the address
        // keep the owner's link dead. Same silent answer, so the cooldown says nothing about the address.
        if (user.PasswordResetRecentlySent(_clock.UtcNow))
            return Unit.Value;

        // Generate a cryptographically random opaque token and store only its hash.
        var plainToken = _tokenGen.GenerateToken();
        var tokenHash = HashToken(plainToken);

        user.SetPasswordResetToken(tokenHash, _clock.UtcNow);
        await _db.SaveChangesAsync(cancellationToken);

        var baseUrl = _auth.ResetPasswordUrl;

        // Build the reset link and email it. Best-effort: a mail failure must not expose
        // the token (it would already be saved) or turn a successful initiation into a 500.
        var resetUrl = $"{baseUrl.TrimEnd('/')}?token={Uri.EscapeDataString(plainToken)}&email={Uri.EscapeDataString(user.Email)}";
        await _email.SendPasswordResetAsync(
            new EmailRecipient(user.Email, user.FullName), resetUrl, cancellationToken);

        return Unit.Value;
    }

    /// <summary>
    /// SHA-256 of the token. Fast enough for a URL-safe string that is already random;
    /// bcrypt's intentional slowness is wasted here and would add 200 ms to every request.
    /// </summary>
    private static string HashToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
