using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

public sealed record LoginCommand(string Email, string Password) : IRequest<Result<LoginResponse>>;

public sealed class LoginCommandValidator : AbstractValidator<LoginCommand>
{
    public LoginCommandValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
        RuleFor(x => x.Password).NotEmpty();
    }
}

public sealed class LoginCommandHandler : IRequestHandler<LoginCommand, Result<LoginResponse>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly ITokenIssuer _tokenIssuer;
    private readonly ISecureTokenGenerator _tokenGen;
    private readonly IDateTimeProvider _clock;
    private readonly ICountryResolver _country;
    private readonly IEmailSender _email;

    public LoginCommandHandler(
        IApplicationDbContext db, IPasswordHasher hasher, ITokenIssuer tokenIssuer,
        ISecureTokenGenerator tokenGen, IDateTimeProvider clock, ICountryResolver country,
        IEmailSender email)
    {
        _db = db;
        _hasher = hasher;
        _tokenIssuer = tokenIssuer;
        _tokenGen = tokenGen;
        _clock = clock;
        _country = country;
        _email = email;
    }

    public async Task<Result<LoginResponse>> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);

        // Every refusal below is the same error after the same amount of work, so a caller cannot tell an
        // unknown address, a Google-only account, a locked one and a wrong password apart — by message or by
        // how long the answer took. Google-created accounts have no password; a distinct PasswordNotSet here
        // would confirm the address is registered to someone who has not proved anything yet.
        if (user?.PasswordHash is null)
        {
            DummyPasswordCheck.Verify(_hasher, request.Password);
            return AuthErrors.InvalidCredentials;
        }

        var now = _clock.UtcNow;
        var passwordMatches = _hasher.Verify(request.Password, user.PasswordHash);

        // Locked accounts are still refused even with the right password; they just are not announced as
        // locked, because "locked" only ever happens to an address that exists.
        if (user.IsLockedOut(now))
            return AuthErrors.InvalidCredentials;

        if (!passwordMatches)
        {
            user.RecordFailedLogin(now);
            await _db.SaveChangesAsync(cancellationToken);
            return AuthErrors.InvalidCredentials;
        }

        if (!user.IsActive)
            return AuthErrors.AccountInactive;

        // Password was right, so this caller owns the account — which is the only point at which it is safe
        // to say anything specific about it. Someone who abandoned the code screen at sign-up lands here;
        // mail them a fresh code so the screen they are about to be routed to has something to accept.
        // Resend is rate-limited on the row, so a login loop cannot turn into a mail loop.
        if (!user.EmailVerified)
        {
            if (user.CanResendEmailVerification(now))
            {
                var code = EmailVerificationCodes.Issue(user, _tokenGen, now);
                await _db.SaveChangesAsync(cancellationToken);
                await _email.SendEmailVerificationAsync(
                    new EmailRecipient(user.Email, user.FullName), code, cancellationToken);
            }

            return AuthErrors.EmailNotVerified;
        }

        // Backfill, and only that. Every account created before countries existed has none, as does anyone
        // whose lookup failed at sign-up; a sign-in is the one moment we can fix that without adding a
        // write path. The null check is what keeps it from being a lookup per login — RecordCountry would
        // refuse the write anyway, but not before paying for the call.
        if (user.Country is null)
            user.RecordCountry(await _country.ResolveAsync(cancellationToken));

        user.RecordSuccessfulLogin(now);
        var tokens = _tokenIssuer.Issue(user);
        await _db.SaveChangesAsync(cancellationToken);

        return new LoginResponse(
            tokens.AccessToken,
            tokens.RefreshToken,
            tokens.ExpiresIn,
            new AuthUserDto(user.Id, user.FullName, user.Email, user.Role.ToString()));
    }
}
