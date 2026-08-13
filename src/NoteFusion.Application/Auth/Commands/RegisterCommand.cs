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

public sealed record RegisterCommand(
    string FullName,
    string Email,
    string Password) : IRequest<Result<LoginResponse>>;

public sealed class RegisterCommandValidator : AbstractValidator<RegisterCommand>
{
    public RegisterCommandValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);
        RuleFor(x => x.Password).NotEmpty().MinimumLength(8);
    }
}

public sealed class RegisterCommandHandler : IRequestHandler<RegisterCommand, Result<LoginResponse>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly ITokenIssuer _tokenIssuer;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;

    public RegisterCommandHandler(
        IApplicationDbContext db, IPasswordHasher hasher, ITokenIssuer tokenIssuer, IDateTimeProvider clock,
        IEmailSender email)
    {
        _db = db;
        _hasher = hasher;
        _tokenIssuer = tokenIssuer;
        _clock = clock;
        _email = email;
    }

    public async Task<Result<LoginResponse>> Handle(RegisterCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        if (await _db.Users.AnyAsync(u => u.Email == email, cancellationToken))
            return UserErrors.EmailAlreadyExists;

        var user = User.Create(request.FullName.Trim(), email, _hasher.Hash(request.Password), _clock.UtcNow);
        _db.Users.Add(user);

        var tokens = _tokenIssuer.Issue(user);
        await _db.SaveChangesAsync(cancellationToken);

        // Welcome the new account. After the commit and best-effort by contract: a mail outage must not
        // fail a sign-up that has already succeeded and handed back tokens.
        await _email.SendWelcomeAsync(new EmailRecipient(user.Email, user.FullName), cancellationToken);

        return new LoginResponse(
            tokens.AccessToken,
            tokens.RefreshToken,
            tokens.ExpiresIn,
            new AuthUserDto(user.Id, user.FullName, user.Email, user.Role.ToString()));
    }
}
