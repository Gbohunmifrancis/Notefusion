using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

/// <summary>
/// Completes a registration: checks the emailed code and, on a match, marks the address verified and
/// issues the token pair <see cref="RegisterCommand"/> withheld. This is where a password sign-up
/// actually becomes a session.
/// </summary>
/// <remarks>
/// Anonymous by necessity — the caller has no token yet, that being the point. What stops it being a way
/// to guess into an account is the attempt cap and 10-minute expiry on the row, not the endpoint: a
/// six-digit code is a million possibilities and there is no rate limiter in front of the API.
/// </remarks>
public sealed record VerifyEmailCommand(string Email, string Code) : IRequest<Result<LoginResponse>>;

public sealed class VerifyEmailCommandValidator : AbstractValidator<VerifyEmailCommand>
{
    public VerifyEmailCommandValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);

        // Length only. Whether the digits are the right ones is the handler's business, and a validation
        // message that distinguished "not 6 digits" from "wrong" would be a free hint to a guesser.
        RuleFor(x => x.Code).NotEmpty().Length(6);
    }
}

public sealed class VerifyEmailCommandHandler : IRequestHandler<VerifyEmailCommand, Result<LoginResponse>>
{
    private readonly IApplicationDbContext _db;
    private readonly ITokenIssuer _tokenIssuer;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;
    private readonly IQuotaGate _gate;

    public VerifyEmailCommandHandler(
        IApplicationDbContext db, ITokenIssuer tokenIssuer, IDateTimeProvider clock, IEmailSender email, IQuotaGate gate)
    {
        _db = db;
        _tokenIssuer = tokenIssuer;
        _clock = clock;
        _email = email;
        _gate = gate;
    }

    public async Task<Result<LoginResponse>> Handle(VerifyEmailCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();

        // One guess at a time per account: five tries is the whole defence of a six-digit code, and parallel
        // guesses that each read the count before the others wrote would get far more than five.
        await using var lease = await _gate.AcquireAsync(QuotaGateExtensions.SignInKey(email), cancellationToken);
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);

        // An unknown address gets the same answer a wrong code does. This endpoint is anonymous, so any
        // distinction here is a way to ask whether an address is registered.
        if (user is null)
            return AuthErrors.InvalidVerificationCode;

        var now = _clock.UtcNow;
        if (!EmailVerificationCodes.Consume(user, request.Code, now))
        {
            // The failed attempt is part of the state that matters: the counter is the whole defence, and
            // an uncommitted increment is no defence at all.
            await _db.SaveChangesAsync(cancellationToken);
            return AuthErrors.InvalidVerificationCode;
        }

        if (!user.IsActive)
            return AuthErrors.AccountInactive;

        user.RecordSuccessfulLogin(now);
        var tokens = _tokenIssuer.IssueForSignIn(user, "email_code");
        await _db.SaveChangesAsync(cancellationToken);

        // Welcome them now rather than at sign-up: this is the first moment we know the address works.
        await _email.SendWelcomeAsync(new EmailRecipient(user.Email, user.FullName), cancellationToken);

        return new LoginResponse(
            tokens.AccessToken,
            tokens.RefreshToken,
            tokens.ExpiresIn,
            new AuthUserDto(user.Id, user.FullName, user.Email, user.Role.ToString()));
    }
}
