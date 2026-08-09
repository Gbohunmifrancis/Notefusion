namespace NoteFusion.Application.Common.Settings;

/// <summary>Google OAuth configuration, bound from the <c>Google</c> section / env vars.</summary>
public sealed class GoogleSettings
{
    /// <summary>The Google OAuth 2.0 Client ID used as the expected audience of ID tokens.</summary>
    public string ClientId { get; set; } = string.Empty;
}
