using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Gateway to the push-notification provider (Expo). Registers a device's expo push token with its
/// owner and resolves the tokens to send to for a set of users.
/// </summary>
public interface IDeviceTokenService
{
    /// <summary>Registers (or refreshes) a device push token for the current user.</summary>
    /// <param name="appBuild">The build this device is running; see <c>DeviceToken.AppBuild</c>.</param>
    Task<Result> RegisterAsync(
        Guid userId, string token, string platform, int appBuild, CancellationToken cancellationToken = default);

    /// <summary>All active device tokens for the given users (used by the push sender).</summary>
    Task<IReadOnlyList<string>> ResolveTokensAsync(
        IReadOnlyList<Guid> userIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// Drops these tokens from every account that holds them: Expo said the phone no longer takes pushes (the app was
    /// uninstalled, or its registration expired). The app registers a fresh one the next time it signs in.
    /// </summary>
    Task<int> ForgetAsync(IReadOnlyList<string> tokens, CancellationToken cancellationToken = default);
}
