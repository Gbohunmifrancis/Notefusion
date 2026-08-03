using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using NoteFusion.Infrastructure.Security;

namespace NoteFusion.Api.Auth;

/// <summary>
/// Configures JWT bearer validation to match the token service: RS256 with the shared
/// <see cref="RsaKeyProvider"/> key, issuer/audience checks, and no inbound claim remapping (so <c>sub</c>
/// and <c>role</c> arrive under their raw names — <see cref="Common.CurrentUser"/> depends on that).
/// </summary>
public sealed class ConfigureJwtBearerOptions : IConfigureNamedOptions<JwtBearerOptions>
{
    private readonly RsaKeyProvider _keys;
    private readonly JwtSettings _settings;

    public ConfigureJwtBearerOptions(RsaKeyProvider keys, JwtSettings settings)
    {
        _keys = keys;
        _settings = settings;
    }

    public void Configure(JwtBearerOptions options) => Configure(Options.DefaultName, options);

    public void Configure(string? name, JwtBearerOptions options)
    {
        options.MapInboundClaims = false; // keep 'sub'/'role' as-is; do not remap to legacy URIs
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = _settings.Issuer,
            ValidateAudience = true,
            ValidAudience = _settings.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = _keys.SecurityKey,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            RoleClaimType = System.Security.Claims.ClaimTypes.Role,
            NameClaimType = "sub"
        };
    }
}
