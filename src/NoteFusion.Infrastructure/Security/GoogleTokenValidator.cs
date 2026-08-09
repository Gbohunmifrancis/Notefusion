using System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;

namespace NoteFusion.Infrastructure.Security;

/// <summary>
/// Validates Google ID tokens against Google's OpenID Connect discovery document and signing keys.
/// Keys are retrieved and cached by <see cref="ConfigurationManager{T}"/>.
/// </summary>
public sealed class GoogleTokenValidator : IGoogleTokenValidator
{
    private const string DiscoveryDocument = "https://accounts.google.com/.well-known/openid-configuration";
    private static readonly string[] ValidIssuers = { "accounts.google.com", "https://accounts.google.com" };

    private readonly GoogleSettings _settings;
    private readonly ConfigurationManager<OpenIdConnectConfiguration> _configurationManager;
    private readonly JwtSecurityTokenHandler _handler = new();

    public GoogleTokenValidator(GoogleSettings settings)
    {
        _settings = settings;
        _configurationManager = new ConfigurationManager<OpenIdConnectConfiguration>(
            DiscoveryDocument,
            new OpenIdConnectConfigurationRetriever(),
            new HttpDocumentRetriever());
    }

    public async Task<GoogleIdentity?> ValidateAsync(string idToken, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(idToken) || string.IsNullOrWhiteSpace(_settings.ClientId))
        {
            return null;
        }

        var config = await _configurationManager.GetConfigurationAsync(cancellationToken);
        var parameters = new TokenValidationParameters
        {
            ValidIssuers = ValidIssuers,
            ValidAudience = _settings.ClientId,
            IssuerSigningKeys = config.SigningKeys,
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        try
        {
            var principal = _handler.ValidateToken(idToken, parameters, out _);
            var subject = principal.FindFirst("sub")?.Value;
            var email = principal.FindFirst("email")?.Value;
            if (string.IsNullOrEmpty(subject) || string.IsNullOrEmpty(email))
            {
                return null;
            }

            var emailVerified = string.Equals(
                principal.FindFirst("email_verified")?.Value, "true", StringComparison.OrdinalIgnoreCase);
            var name = principal.FindFirst("name")?.Value;
            var picture = principal.FindFirst("picture")?.Value;

            return new GoogleIdentity(subject, email, emailVerified, name, picture);
        }
        catch (SecurityTokenException)
        {
            return null;
        }
    }
}
