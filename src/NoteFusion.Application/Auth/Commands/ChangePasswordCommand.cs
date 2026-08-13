using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

public sealed record ChangePasswordCommand(string CurrentPassword, string NewPassword) : IRequest<Result<ChangePasswordResponse>>;

public sealed class ChangePasswordCommandValidator : AbstractValidator<ChangePasswordCommand>
{
    public ChangePasswordCommandValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty();
        RuleFor(x => x.NewPassword).NotEmpty().MinimumLength(8);
    }
}

public sealed class ChangePasswordCommandHandler : IRequestHandler<ChangePasswordCommand, Result<ChangePasswordResponse>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly ITokenIssuer _tokenIssuer;
    private readonly IDateTimeProvider _clock;
    private readonly ICurrentUser _currentUser;
    private readonly IEmailSender _email;

    public ChangePasswordCommandHandler(
        IApplicationDbContext db, IPasswordHasher hasher, ITokenIssuer tokenIssuer,
        IDateTimeProvider clock, ICurrentUser currentUser, IEmailSender email)
    {
        _db = db;
        _hasher = hasher;
        _tokenIssuer = tokenIssuer;
        _clock = clock;
        _currentUser = currentUser;
        _email = email;
    }

    public async Task<Result<ChangePasswordResponse>> Handle(ChangePasswordCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return AuthErrors.InvalidCredentials;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
            return AuthErrors.CurrentPasswordIncorrect;

        // The caller is already authenticated as this user, so naming the real reason
        // leaks nothing and lets the client offer "set a password" instead.
        if (user.PasswordHash is null)
            return AuthErrors.PasswordNotSet;

        if (!_hasher.Verify(request.CurrentPassword, user.PasswordHash))
            return AuthErrors.CurrentPasswordIncorrect;

        user.ChangePassword(_hasher.Hash(request.NewPassword), _clock.UtcNow);
        var tokens = _tokenIssuer.Issue(user);
        await _db.SaveChangesAsync(cancellationToken);

        // Security notice, sent whether or not the user expected it: if the change was not theirs, this
        // email is how they find out. Post-commit and best-effort — the password has already changed.
        await _email.SendPasswordChangedAsync(new EmailRecipient(user.Email, user.FullName), cancellationToken);

        return new ChangePasswordResponse(tokens.AccessToken, tokens.RefreshToken, tokens.ExpiresIn);
    }
}
