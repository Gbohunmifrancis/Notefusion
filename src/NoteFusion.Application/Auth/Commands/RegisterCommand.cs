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
/// <para>
/// An address that already has an account gets the identical answer, so the form cannot be used to find
/// out who has one; its owner is emailed instead (at most once per
/// <see cref="User.AccountExistsNoticeCooldown"/>), telling them to sign in or reset their password.
/// </para>
/// </remarks>
public sealed record RegisterCommand(
    string FullName,
    string Email,
    string Password,
    /// <summary>Which client is signing up: "web" or "mobile". Optional; the dashboard's funnel reads it.</summary>
    string? Source = null) : IRequest<Result<RegistrationResponse>>;

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

        // Refused on the domain alone, before anything is looked up, so the answer says nothing about
        // whether the address has an account. Existing accounts on such a domain are not touched.
        if (DisposableEmailDomains.IsDisposable(email))
            return AuthErrors.DisposableEmail;

        // Hashed whether or not the address is taken, so the two answers below also take the same time.
        var passwordHash = _hasher.Hash(request.Password);

        var existing = await _db.Users
            .Where(u => u.Email == email)
            .Select(u => new { u.Id, u.Email, u.FullName })
            .FirstOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            // A taken address gets the same answer as a new one: "already exists" told anyone who asked
            // whether a given person has an account. The owner hears about it by email instead, and only the
            // owner can act on it. Nothing about the account changes — in particular not its password, or
            // an unverified sign-up could be taken over by whoever registers the address next.
            var now = _clock.UtcNow;
            var quietSince = now - User.AccountExistsNoticeCooldown;
            var claimed = await _db.Users
                .Where(u => u.Id == existing.Id
                            && (u.AccountExistsNoticeSentAtUtc == null || u.AccountExistsNoticeSentAtUtc < quietSince))
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.AccountExistsNoticeSentAtUtc, now), cancellationToken);
            if (claimed == 1)
            {
                await _email.SendAccountAlreadyExistsAsync(
                    new EmailRecipient(existing.Email, existing.FullName), cancellationToken);
            }

            return new RegistrationResponse(email);
        }

        var user = User.Create(request.FullName.Trim(), email, passwordHash, _clock.UtcNow);

        // Before the insert, so the country rides the same commit as the account. Which tier this person
        // is offered follows from it, and a resolver that never throws means a geolocation outage costs us
        // the country, not the sign-up.
        user.RecordCountry(await _country.ResolveAsync(cancellationToken));
        user.RecordSignupSource(request.Source);

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
