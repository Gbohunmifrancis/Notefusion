using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Push;

/// <summary>
/// Persists expo push tokens against their owning user and resolves them for the push sender.
/// Registration is idempotent per (user, token): re-registering an existing device just refreshes
/// its <c>UpdatedAt</c> (handled by <see cref="User.RegisterDeviceToken"/>).
/// </summary>
public sealed class DeviceTokenService : IDeviceTokenService
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public DeviceTokenService(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result> RegisterAsync(
        Guid userId, string token, string platform, CancellationToken cancellationToken = default)
    {
        var user = await _db.Users
            .Include(u => u.DeviceTokens)
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);

        if (user is null)
            return Error.NotFound("Device.UserNotFound", "The user was not found.");

        user.RegisterDeviceToken(token, platform, _clock.UtcNow);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<string>> ResolveTokensAsync(
        IReadOnlyList<Guid> userIds, CancellationToken cancellationToken = default)
    {
        if (userIds.Count == 0)
            return [];

        return await _db.DeviceTokens
            .Where(t => userIds.Contains(t.UserId))
            .Select(t => t.Token)
            .ToListAsync(cancellationToken);
    }
}
