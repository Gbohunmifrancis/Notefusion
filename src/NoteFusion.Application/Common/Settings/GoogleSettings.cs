namespace NoteFusion.Application.Common.Settings;

/// <summary>Google OAuth configuration, bound from the <c>Google</c> section / env vars.</summary>
public sealed class GoogleSettings
{
    /// <summary>
    /// The web OAuth client ID. This is the audience of ID tokens issued to the Android app, which
    /// asks Google for a token audienced to the server rather than to itself.
    /// </summary>
    public string ClientId { get; set; } = string.Empty;

    /// <summary>
    /// The iOS OAuth client ID, if the app ships on iOS. Google's iOS SDK audiences ID tokens to
    /// the iOS client, so it is a second valid audience rather than a replacement. Empty is fine:
    /// only the configured ones are accepted.
    /// </summary>
    public string IosClientId { get; set; } = string.Empty;
}
