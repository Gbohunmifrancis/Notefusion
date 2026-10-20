using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Me.Queries;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Me.Commands;

public sealed record UpdateMyProfileCommand(
    string FullName,
    string? PhoneNumber) : IRequest<Result<MyProfileDto>>;

public sealed class UpdateMyProfileCommandValidator : AbstractValidator<UpdateMyProfileCommand>
{
    public UpdateMyProfileCommandValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.PhoneNumber).MaximumLength(30).When(x => x.PhoneNumber is not null);
    }
}

public sealed class UpdateMyProfileCommandHandler : IRequestHandler<UpdateMyProfileCommand, Result<MyProfileDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public UpdateMyProfileCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<MyProfileDto>> Handle(UpdateMyProfileCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
            return UserErrors.NotFound;

        // The clients send the name alone: a phone left out is kept, and only an empty one clears it.
        var phone = request.PhoneNumber is null ? user.PhoneNumber
            : string.IsNullOrWhiteSpace(request.PhoneNumber) ? null : request.PhoneNumber.Trim();
        user.UpdateProfile(request.FullName.Trim(), phone);
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
