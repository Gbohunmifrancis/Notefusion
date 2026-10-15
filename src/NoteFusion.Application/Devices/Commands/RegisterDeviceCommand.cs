using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Devices.Commands;

/// <param name="AppBuild">
/// The build this device is running. Registration runs on every sign-in, so this is how the server
/// learns which devices are behind a store release — and therefore who the update notice is for.
/// Zero from an older client, which reads as "behind".
/// </param>
public sealed record RegisterDeviceCommand(string Token, string Platform, int AppBuild = 0) : IRequest<Result>;

public sealed class RegisterDeviceCommandValidator : AbstractValidator<RegisterDeviceCommand>
{
    public RegisterDeviceCommandValidator()
    {
        RuleFor(x => x.Token).NotEmpty();
        RuleFor(x => x.Platform).NotEmpty().Must(p => p is "ios" or "android" or "web");
        RuleFor(x => x.AppBuild).GreaterThanOrEqualTo(0);
    }
}

public sealed class RegisterDeviceCommandHandler : IRequestHandler<RegisterDeviceCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly ICurrentUser _currentUser;

    public RegisterDeviceCommandHandler(
        IApplicationDbContext db, IDateTimeProvider clock, ICurrentUser currentUser)
    {
        _db = db;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(RegisterDeviceCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        // DeviceTokens must be loaded: RegisterDeviceToken dedupes by scanning the collection,
        // so without this the re-register path always Adds and trips the unique index on
        // (UserId, Token). Registration runs on every sign-in, so that is the common case.
        var user = await _db.Users
            .Include(u => u.DeviceTokens)
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
            return UserErrors.NotFound;

        // A push token names a handset, not a person. On a shared phone the previous account's row would
        // otherwise keep sending its notifications (and its sheets' titles) to whoever is signed in now, so
        // the token belongs to the account registering it and nobody else.
        await _db.DeviceTokens
            .Where(t => t.Token == request.Token && t.UserId != userId)
            .ExecuteDeleteAsync(cancellationToken);

        user.RegisterDeviceToken(request.Token, request.Platform, request.AppBuild, _clock.UtcNow);
        await _db.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }
}
