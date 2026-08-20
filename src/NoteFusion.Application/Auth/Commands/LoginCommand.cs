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
    private readonly IDateTimeProvider _clock;
    private readonly ICountryResolver _country;

    public LoginCommandHandler(
        IApplicationDbContext db, IPasswordHasher hasher, ITokenIssuer tokenIssuer, IDateTimeProvider clock,
        ICountryResolver country)
    {
        _db = db;
        _hasher = hasher;
        _tokenIssuer = tokenIssuer;
        _clock = clock;
        _country = country;
    }

    public async Task<Result<LoginResponse>> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
        if (user is null)
            return AuthErrors.InvalidCredentials;

        var now = _clock.UtcNow;
        if (user.IsLockedOut(now))
            return AuthErrors.AccountLocked(user.LockoutEndAt!.Value);

        // Google-created accounts have no password. Report the generic credential error
        // rather than PasswordNotSet: at this point the caller is unauthenticated, and a
        // distinct message would confirm the address is registered.
        if (user.PasswordHash is null)
            return AuthErrors.InvalidCredentials;

        if (!_hasher.Verify(request.Password, user.PasswordHash))
        {
            user.RecordFailedLogin(now);
            await _db.SaveChangesAsync(cancellationToken);
            return user.IsLockedOut(now)
                ? AuthErrors.AccountLocked(user.LockoutEndAt!.Value)
                : AuthErrors.InvalidCredentials;
        }

        if (!user.IsActive)
            return AuthErrors.AccountInactive;

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
