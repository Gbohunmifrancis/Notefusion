using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

/// <summary>
/// Completes the password-reset flow initiated by <see cref="ForgotPasswordCommand"/>.
/// Consumes the one-time token, replaces the stored password hash and signs the account out of every
/// session: a reset is how someone takes an account back, so a session opened with the old password
/// must not outlive it.
/// </summary>
public sealed record ResetPasswordCommand(
    string Email,
    string Token,
    string NewPassword) : IRequest<Result<Unit>>;

public sealed class ResetPasswordCommandValidator : AbstractValidator<ResetPasswordCommand>
{
    public ResetPasswordCommandValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);
        RuleFor(x => x.Token).NotEmpty();
        RuleFor(x => x.NewPassword).NotEmpty().MinimumLength(8);
    }
}

public sealed class ResetPasswordCommandHandler : IRequestHandler<ResetPasswordCommand, Result<Unit>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;

    public ResetPasswordCommandHandler(
        IApplicationDbContext db, IPasswordHasher hasher, IDateTimeProvider clock, IEmailSender email)
    {
        _db = db;
        _hasher = hasher;
        _clock = clock;
        _email = email;
    }

    public async Task<Result<Unit>> Handle(ResetPasswordCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);

        // Hashed before anything is decided, so an unknown address costs the same time as a known one: the
        // answer below is the same either way, and so must be how long it takes to arrive.
        var newPasswordHash = _hasher.Hash(request.NewPassword);

        // Avoid revealing whether the email is registered. Token mismatch and unknown email
        // both return the same generic error.
        if (user is null)
            return AuthErrors.InvalidResetToken;

        var tokenHash = HashToken(request.Token);

        if (!user.ConsumePasswordResetToken(tokenHash, newPasswordHash, _clock.UtcNow))
            return AuthErrors.InvalidResetToken;

        await RefreshTokenRevocation.RevokeAllAsync(_db, user.Id, _clock.UtcNow, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        await _email.SendPasswordChangedAsync(new EmailRecipient(user.Email, user.FullName), cancellationToken);

        return Unit.Value;
    }

    private static string HashToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
