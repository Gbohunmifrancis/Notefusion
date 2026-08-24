using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Devices.Commands;

public sealed record UnregisterDeviceCommand(string Token) : IRequest<Result>;

public sealed class UnregisterDeviceCommandValidator : AbstractValidator<UnregisterDeviceCommand>
{
    public UnregisterDeviceCommandValidator()
    {
        RuleFor(x => x.Token).NotEmpty();
    }
}

/// <summary>
/// Removes this device's push token so the server stops sending to it. Without this the
/// client's "notifications off" switch is cosmetic: muting the in-app handler does nothing
/// once the app is backgrounded, because the OS renders whatever arrives.
/// </summary>
public sealed class UnregisterDeviceCommandHandler : IRequestHandler<UnregisterDeviceCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public UnregisterDeviceCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(UnregisterDeviceCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var user = await _db.Users
            .Include(u => u.DeviceTokens)
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null)
            return UserErrors.NotFound;

        // Idempotent: turning notifications off twice, or from a device whose token was already
        // pruned, is a success. The caller only cares that we will not send there any more.
        if (user.RemoveDeviceToken(request.Token))
            await _db.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }
}
