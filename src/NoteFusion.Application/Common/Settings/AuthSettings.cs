namespace NoteFusion.Application.Common.Settings;

/// <summary>Auth token lifetimes, bound from configuration (JWT_* / Auth section).</summary>
public sealed class AuthSettings
{
    public int AccessTokenMinutes { get; set; } = 60;
    public int RefreshTokenDays { get; set; } = 7;
}
