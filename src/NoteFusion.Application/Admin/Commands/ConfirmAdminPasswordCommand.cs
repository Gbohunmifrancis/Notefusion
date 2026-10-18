using FluentValidation;
using MediatR;
using NoteFusion.Application.Admin.PhoneLock;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// The admin types their own account password to confirm a destructive action on a phone with no fingerprint or face
/// sensor (board f-admin/10). Checks it (a wrong one counts towards the sign-in lockout) and, given the phone's open
/// Admin pass, marks the pass freshly confirmed, which those actions require of a phone.
/// </summary>
public sealed record ConfirmAdminPasswordCommand(string Password, string? Session = null) : IRequest<Result>;

public sealed class ConfirmAdminPasswordCommandValidator : AbstractValidator<ConfirmAdminPasswordCommand>
{
    public ConfirmAdminPasswordCommandValidator() => RuleFor(x => x.Password).NotEmpty().MaximumLength(200);
}

public sealed class ConfirmAdminPasswordCommandHandler : IRequestHandler<ConfirmAdminPasswordCommand, Result>
{
    public static readonly Error Incorrect = AdminPassword.Incorrect;
    public static readonly Error NotSet = AdminPassword.NotSet;
    public static readonly Error LockedOut = AdminPassword.LockedOut;

    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IPasswordHasher _hasher;
    private readonly IDateTimeProvider _clock;
    private readonly IAdminPhoneLock? _lock;

    public ConfirmAdminPasswordCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IPasswordHasher hasher, IDateTimeProvider clock,
        IAdminPhoneLock? phoneLock = null)
    {
        _db = db;
        _caller = caller;
        _hasher = hasher;
        _clock = clock;
        _lock = phoneLock;
    }

    public async Task<Result> Handle(ConfirmAdminPasswordCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        var now = _clock.UtcNow;
        var checkedUser = await AdminPassword.CheckAsync(_db, _hasher, userId, request.Password, now, ct);
        if (checkedUser.IsFailure)
            return checkedUser.Error;

        _lock?.MarkFresh(request.Session, userId, now);
        return Result.Success();
    }
}
