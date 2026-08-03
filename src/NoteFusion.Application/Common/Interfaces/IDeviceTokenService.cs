using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Gateway to the push-notification provider (Expo). Registers a device's expo push token with its
/// owner and resolves the tokens to send to for a set of users.
/// </summary>
public interface IDeviceTokenService
{
    /// <summary>Registers (or refreshes) a device push token for the current user.</summary>
    Task<Result> RegisterAsync(
        Guid userId, string token, string platform, CancellationToken cancellationToken = default);

    /// <summary>All active device tokens for the given users (used by the push sender).</summary>
    Task<IReadOnlyList<string>> ResolveTokensAsync(
        IReadOnlyList<Guid> userIds, CancellationToken cancellationToken = default);
}
