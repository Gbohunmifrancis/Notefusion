using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Me.Commands;

/// <summary>
/// Self-service account closure. Irreversible, so the caller re-enters their password:
/// a valid access token alone is a weaker signal than intent (an unlocked handset is
/// enough for the former, not the latter).
/// </summary>
public sealed record DeleteMyAccountCommand(string Password) : IRequest<Result>;

public sealed class DeleteMyAccountCommandValidator : AbstractValidator<DeleteMyAccountCommand>
{
    public DeleteMyAccountCommandValidator()
    {
        RuleFor(x => x.Password).NotEmpty();
    }
}

public sealed class DeleteMyAccountCommandHandler : IRequestHandler<DeleteMyAccountCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly ICurrentUser _currentUser;

    public DeleteMyAccountCommandHandler(IApplicationDbContext db, IPasswordHasher hasher, ICurrentUser currentUser)
    {
        _db = db;
        _hasher = hasher;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(DeleteMyAccountCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
            return UserErrors.NotFound;

        if (!_hasher.Verify(request.Password, user.PasswordHash))
            return AuthErrors.CurrentPasswordIncorrect;

        // Transcriptions carry a UserId but no navigation, so EF declares no relationship
        // and no cascade fires for them — they have to go explicitly or they outlive the
        // account as unreachable rows. Refresh tokens and device tokens do cascade.
        var transcriptions = await _db.Transcriptions
            .Where(t => t.UserId == userId)
            .ToListAsync(cancellationToken);
        _db.Transcriptions.RemoveRange(transcriptions);

        _db.Users.Remove(user);
        await _db.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }
}
