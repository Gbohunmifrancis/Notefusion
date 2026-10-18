using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// The phone admin's lock on a phone with no screen lock and no fingerprint or face (board f-admin/10): the admin
/// types their own account password instead. Checks it and nothing else: no token is issued, no session changes. A
/// wrong one counts towards the same lockout a wrong sign-in does, so this is no easier a door to guess at.
/// </summary>
public sealed record ConfirmAdminPasswordCommand(string Password) : IRequest<Result>;

public sealed class ConfirmAdminPasswordCommandValidator : AbstractValidator<ConfirmAdminPasswordCommand>
{
    public ConfirmAdminPasswordCommandValidator() => RuleFor(x => x.Password).NotEmpty().MaximumLength(200);
}

public sealed class ConfirmAdminPasswordCommandHandler : IRequestHandler<ConfirmAdminPasswordCommand, Result>
{
    public static readonly Error Incorrect =
        Error.Validation("ADMIN_PASSWORD_INCORRECT", "That password is not right. Try again.");

    public static readonly Error NotSet =
        Error.Validation("ADMIN_PASSWORD_NOT_SET",
            "This account signs in with Google, so it has no password to check. Set a screen lock on this phone to open Admin.");

    public static readonly Error LockedOut =
        Error.Forbidden("ADMIN_PASSWORD_LOCKED", "Too many tries. Wait 15 minutes, then try again.");

    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IPasswordHasher _hasher;
    private readonly IDateTimeProvider _clock;

    public ConfirmAdminPasswordCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IPasswordHasher hasher, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _hasher = hasher;
        _clock = clock;
    }

    public async Task<Result> Handle(ConfirmAdminPasswordCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return AdminErrors.NotAuthenticated;
        if (user.PasswordHash is null)
            return NotSet;

        var now = _clock.UtcNow;
        if (user.IsLockedOut(now))
            return LockedOut;

        if (_hasher.Verify(request.Password, user.PasswordHash))
            return Result.Success();

        user.RecordFailedLogin(now);
        await _db.SaveChangesAsync(ct);
        return user.IsLockedOut(now) ? LockedOut : Incorrect;
    }
}
