using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Me.Queries;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Me.Commands;

/// <summary>
/// Replaces the caller's avatar. <paramref name="Content"/> is the open request stream — the
/// controller owns its lifetime, so the handler must not dispose it or hold it past the call.
/// Size and content type are checked at the edge, where the multipart headers are still available.
/// </summary>
public sealed record UpdateMyProfilePictureCommand(
    Stream Content,
    string FileName) : IRequest<Result<MyProfileDto>>;

public sealed class UpdateMyProfilePictureCommandHandler
    : IRequestHandler<UpdateMyProfilePictureCommand, Result<MyProfileDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IImageStorage _storage;

    public UpdateMyProfilePictureCommandHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IImageStorage storage)
    {
        _db = db;
        _currentUser = currentUser;
        _storage = storage;
    }

    public async Task<Result<MyProfileDto>> Handle(
        UpdateMyProfilePictureCommand request,
        CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
            return UserErrors.NotFound;

        // Upload first, save second: a failed upload must leave the existing picture in place
        // rather than clearing it and showing initials for a photo the user still has.
        var upload = await _storage.UploadAvatarAsync(
            request.Content, request.FileName, userId, cancellationToken);
        if (upload.IsFailure)
            return Result.Failure<MyProfileDto>(upload.Error);

        user.SetProfilePicture(upload.Value);
        await _db.SaveChangesAsync(cancellationToken);

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
