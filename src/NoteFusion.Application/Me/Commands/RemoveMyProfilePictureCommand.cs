using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Me.Queries;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Me.Commands;

/// <summary>Clears the caller's avatar, sending them back to their initials.</summary>
public sealed record RemoveMyProfilePictureCommand : IRequest<Result<MyProfileDto>>;

public sealed class RemoveMyProfilePictureCommandHandler
    : IRequestHandler<RemoveMyProfilePictureCommand, Result<MyProfileDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IImageStorage _storage;

    public RemoveMyProfilePictureCommandHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IImageStorage storage)
    {
        _db = db;
        _currentUser = currentUser;
        _storage = storage;
    }

    public async Task<Result<MyProfileDto>> Handle(
        RemoveMyProfilePictureCommand request,
        CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
            return UserErrors.NotFound;

        // Null clears it — the domain method takes a nullable url for exactly this.
        user.SetProfilePicture(null);
        await _db.SaveChangesAsync(cancellationToken);

        // The record is what the app reads, so it is cleared first and the file after. Storage is
        // best-effort by contract, and the save has already committed by now: letting an exception
        // out here would report failure for an operation that succeeded, leaving the app to say
        // "couldn't remove photo" about a photo that is gone.
        try
        {
            await _storage.DeleteAvatarAsync(userId, cancellationToken);
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            // A stranded object in the bucket is a cleanup job, not a failed request.
        }

        return new MyProfileDto(
            user.Id,
            user.FullName,
            user.Email,
            user.Role.ToString(),
            user.ProfilePictureUrl,
            user.PasswordHash is not null,
            user.CreatedAt);
    }
}
