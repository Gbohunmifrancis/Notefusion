using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

/// <summary>
/// Creates an account and emails a six-digit code to the address given. Deliberately returns <b>no
/// tokens</b>: the account is unusable until <see cref="VerifyEmailCommand"/> is satisfied.
/// </summary>
/// <remarks>
/// Handing back tokens here and nagging afterwards would make verification advisory, and an address
/// nobody has proved is one we would still be mailing receipts and reset links to. The cost is one extra
/// screen at sign-up; the benefit is that every password account in the database has a reachable mailbox
/// behind it.
/// </remarks>
public sealed record RegisterCommand(
    string FullName,
    string Email,
    string Password) : IRequest<Result<RegistrationResponse>>;

public sealed class RegisterCommandValidator : AbstractValidator<RegisterCommand>
{
    public RegisterCommandValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);
        RuleFor(x => x.Password).NotEmpty().MinimumLength(8);
    }
}

public sealed class RegisterCommandHandler : IRequestHandler<RegisterCommand, Result<RegistrationResponse>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly ISecureTokenGenerator _tokenGen;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;
    private readonly ICountryResolver _country;

    public RegisterCommandHandler(
        IApplicationDbContext db, IPasswordHasher hasher, ISecureTokenGenerator tokenGen,
        IDateTimeProvider clock, IEmailSender email, ICountryResolver country)
    {
        _db = db;
        _hasher = hasher;
        _tokenGen = tokenGen;
        _clock = clock;
        _email = email;
        _country = country;
    }

    public async Task<Result<RegistrationResponse>> Handle(RegisterCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        if (await _db.Users.AnyAsync(u => u.Email == email, cancellationToken))
            return UserErrors.EmailAlreadyExists;

        var user = User.Create(request.FullName.Trim(), email, _hasher.Hash(request.Password), _clock.UtcNow);

        // Before the insert, so the country rides the same commit as the account. Which tier this person
        // is offered follows from it, and a resolver that never throws means a geolocation outage costs us
        // the country, not the sign-up.
        user.RecordCountry(await _country.ResolveAsync(cancellationToken));

        var code = EmailVerificationCodes.Issue(user, _tokenGen, _clock.UtcNow);

        _db.Users.Add(user);
        await _db.SaveChangesAsync(cancellationToken);

        // The code, after the commit and best-effort by contract. The welcome email waits for
        // VerifyEmailCommand — one message at a time, and no welcome to a mailbox we have not reached yet.
        await _email.SendEmailVerificationAsync(
            new EmailRecipient(user.Email, user.FullName), code, cancellationToken);

        return new RegistrationResponse(user.Email);
    }
}
