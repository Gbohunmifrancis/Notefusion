using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

/// <summary>
/// Initiates a password-reset flow for the supplied email. Deliberately never discloses whether
/// an account with that email exists — callers always receive a 204 so a probe cannot enumerate
/// registered addresses.
/// </summary>
public sealed record ForgotPasswordCommand(
    string Email,
    /// <summary>
    /// The front-end URL that the emailed link resolves to, e.g.
    /// <c>https://notefusion.studio/reset-password</c>. The raw token is appended as
    /// <c>?token=&lt;value&gt;</c> by the handler.
    /// </summary>
    string? ResetBaseUrl = null) : IRequest<Result<Unit>>;

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
    private readonly ILogger<ForgotPasswordCommandHandler> _logger;

    public ForgotPasswordCommandHandler(
        IApplicationDbContext db, ISecureTokenGenerator tokenGen, IDateTimeProvider clock,
        IEmailSender email, ILogger<ForgotPasswordCommandHandler> logger)
    {
        _db = db;
        _tokenGen = tokenGen;
        _clock = clock;
        _email = email;
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

        // Generate a cryptographically random opaque token and store only its hash.
        var plainToken = _tokenGen.GenerateToken();
        var tokenHash = HashToken(plainToken);

        user.SetPasswordResetToken(tokenHash, _clock.UtcNow);
        await _db.SaveChangesAsync(cancellationToken);

        var baseUrl = string.IsNullOrWhiteSpace(request.ResetBaseUrl)
            ? "https://notefusion-admin.vercel.app/reset-password"
            : request.ResetBaseUrl;

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
