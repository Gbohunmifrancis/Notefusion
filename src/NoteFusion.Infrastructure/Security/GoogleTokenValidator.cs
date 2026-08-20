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

    // MapInboundClaims must stay off: left at its default of true, the handler renames every
    // claim read below to a legacy WS-* URI ('sub' becomes ClaimTypes.NameIdentifier, 'email'
    // becomes ClaimTypes.Email), so each lookup returns null and a perfectly valid token is
    // rejected as invalid — after its signature, issuer and audience have all passed. Same
    // reason ConfigureJwtBearerOptions turns it off for our own tokens.
    private readonly JwtSecurityTokenHandler _handler = new() { MapInboundClaims = false };

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
        // Every platform's SDK audiences its ID token to a different client, so the accepted set is
        // whichever clients are configured — never a single one, and never all of them blindly.
        var audiences = new[] { _settings.ClientId, _settings.IosClientId }
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToArray();

        if (string.IsNullOrWhiteSpace(idToken) || audiences.Length == 0)
        {
            return null;
        }

        var config = await _configurationManager.GetConfigurationAsync(cancellationToken);
        var parameters = new TokenValidationParameters
        {
            ValidIssuers = ValidIssuers,
            ValidAudiences = audiences,
            IssuerSigningKeys = config.SigningKeys,
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        return ReadIdentity(idToken, parameters);
    }

    /// <summary>
    /// Validates the token and reads the OIDC claims off it. Split from <see cref="ValidateAsync"/>
    /// so it can be exercised with a locally signed token instead of Google's live signing keys.
    /// </summary>
    internal GoogleIdentity? ReadIdentity(string idToken, TokenValidationParameters parameters)
    {
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
