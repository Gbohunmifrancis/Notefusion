using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Me.Commands;

/// <summary>
/// Self-service account closure. Irreversible, so the caller re-proves who they are:
/// a valid access token alone is a weaker signal than intent (an unlocked handset is
/// enough for the former, not the latter).
///
/// Exactly one proof is required. Password accounts send <paramref name="Password"/>;
/// Google accounts have none, so they send a freshly minted <paramref name="GoogleIdToken"/>
/// instead — obtaining one means completing Google's sign-in flow again, which carries the
/// same "prove it is you, now" weight as retyping a password.
/// </summary>
public sealed record DeleteMyAccountCommand(string? Password, string? GoogleIdToken) : IRequest<Result>;

public sealed class DeleteMyAccountCommandValidator : AbstractValidator<DeleteMyAccountCommand>
{
    public DeleteMyAccountCommandValidator()
    {
        RuleFor(x => x)
            .Must(x => !string.IsNullOrWhiteSpace(x.Password) || !string.IsNullOrWhiteSpace(x.GoogleIdToken))
            .WithMessage("Either a password or a Google ID token is required to close the account.");
    }
}

public sealed class DeleteMyAccountCommandHandler : IRequestHandler<DeleteMyAccountCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly IGoogleTokenValidator _googleTokenValidator;
    private readonly ICurrentUser _currentUser;

    public DeleteMyAccountCommandHandler(
        IApplicationDbContext db,
        IPasswordHasher hasher,
        IGoogleTokenValidator googleTokenValidator,
        ICurrentUser currentUser)
    {
        _db = db;
        _hasher = hasher;
        _googleTokenValidator = googleTokenValidator;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(DeleteMyAccountCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
            return UserErrors.NotFound;

        var reauthenticated = await IsReauthenticatedAsync(user, request, cancellationToken);
        if (!reauthenticated)
            return AuthErrors.ReauthenticationRequired;

        // Transcriptions carry a UserId but no navigation, so EF declares no relationship
        // and no cascade fires for them — they have to go explicitly or they outlive the
        // account as unreachable rows. Refresh tokens and device tokens do cascade.
        var transcriptions = await _db.Transcriptions
            .Where(t => t.UserId == userId)
            .ToListAsync(cancellationToken);
        _db.Transcriptions.RemoveRange(transcriptions);

        // Folder links have no relationship either. Left behind, a public link would come back to life for
        // whoever next registers this address (the id is derived from it) and files sheets under that name.
        _db.FolderShares.RemoveRange(await _db.FolderShares.Where(f => f.UserId == userId).ToListAsync(cancellationToken));

        // The phone's own events are the account's: they go with it.
        _db.AppEvents.RemoveRange(await _db.AppEvents.Where(e => e.UserId == userId).ToListAsync(cancellationToken));

        _db.Users.Remove(user);
        await _db.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }

    /// <summary>
    /// Accepts a password only when the account actually has one, and a Google token only
    /// when it resolves to the very account being deleted — otherwise anyone holding a valid
    /// token for <em>some</em> Google account could close <em>this</em> one.
    /// </summary>
    private async Task<bool> IsReauthenticatedAsync(
        Core.Entities.User user, DeleteMyAccountCommand request, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(request.Password) && user.PasswordHash is not null)
            return _hasher.Verify(request.Password, user.PasswordHash);

        if (!string.IsNullOrWhiteSpace(request.GoogleIdToken) && user.GoogleId is not null)
        {
            var identity = await _googleTokenValidator.ValidateAsync(request.GoogleIdToken, cancellationToken);
            return identity is not null && identity.SubjectId == user.GoogleId;
        }

        return false;
    }
}
