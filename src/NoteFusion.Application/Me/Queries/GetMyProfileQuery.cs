using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Me.Queries;

public sealed record GetMyProfileQuery : IRequest<Result<MyProfileDto>>;

/// <param name="ProfilePictureUrl">Avatar URL, or null if the user has not set one.</param>
/// <param name="HasPassword">
/// False for Google-only accounts. The client needs this to know whether to offer
/// "change password" or "set a password", and which proof to send when closing the account.
/// </param>
public sealed record MyProfileDto(
    Guid Id,
    string FullName,
    string Email,
    string Role,
    string? ProfilePictureUrl,
    bool HasPassword,
    DateTime CreatedAt);

public sealed class GetMyProfileQueryHandler : IRequestHandler<GetMyProfileQuery, Result<MyProfileDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public GetMyProfileQueryHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<MyProfileDto>> Handle(GetMyProfileQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
            return UserErrors.NotFound;

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
