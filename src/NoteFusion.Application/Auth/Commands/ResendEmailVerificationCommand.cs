using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

/// <summary>
/// Sends a fresh verification code to an address whose sign-up was never completed. Always succeeds from
/// the caller's point of view, whatever actually happened.
/// </summary>
/// <remarks>
/// Same rule as <see cref="ForgotPasswordCommand"/>: nothing about the destination is a caller parameter
/// and no outcome is disclosed. An unknown address, an already-verified account and a request inside the
/// cooldown all return success, because the alternatives are respectively an account-enumeration oracle,
/// a way to ask "has this person finished signing up?", and a timing signal that answers both.
/// </remarks>
public sealed record ResendEmailVerificationCommand(string Email) : IRequest<Result<Unit>>;

public sealed class ResendEmailVerificationCommandValidator : AbstractValidator<ResendEmailVerificationCommand>
{
    public ResendEmailVerificationCommandValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);
    }
}

public sealed class ResendEmailVerificationCommandHandler
    : IRequestHandler<ResendEmailVerificationCommand, Result<Unit>>
{
    private readonly IApplicationDbContext _db;
    private readonly ISecureTokenGenerator _tokenGen;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;
    private readonly ILogger<ResendEmailVerificationCommandHandler> _logger;

    public ResendEmailVerificationCommandHandler(
        IApplicationDbContext db, ISecureTokenGenerator tokenGen, IDateTimeProvider clock,
        IEmailSender email, ILogger<ResendEmailVerificationCommandHandler> logger)
    {
        _db = db;
        _tokenGen = tokenGen;
        _clock = clock;
        _email = email;
        _logger = logger;
    }

    public async Task<Result<Unit>> Handle(
        ResendEmailVerificationCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);

        // Debug-level so the reason is visible in development without ever reaching the client.
        if (user is null)
        {
            _logger.LogDebug("Verification resend for unknown email {Email} — silently ignored.", email);
            return Unit.Value;
        }

        if (user.EmailVerified)
        {
            _logger.LogDebug("Verification resend for already-verified {Email} — nothing to send.", email);
            return Unit.Value;
        }

        var now = _clock.UtcNow;

        // The cooldown is the only thing standing between this endpoint and a mail-bombing tool: it is
        // anonymous, and any address can be named. Refusing quietly keeps the client's countdown honest
        // without telling a caller whether their request landed.
        if (!user.CanResendEmailVerification(now))
        {
            _logger.LogDebug("Verification resend for {Email} inside the cooldown — ignored.", email);
            return Unit.Value;
        }

        var code = EmailVerificationCodes.Issue(user, _tokenGen, now);
        await _db.SaveChangesAsync(cancellationToken);

        await _email.SendEmailVerificationAsync(
            new EmailRecipient(user.Email, user.FullName), code, cancellationToken);

        return Unit.Value;
    }
}
