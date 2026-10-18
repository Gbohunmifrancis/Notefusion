using System.IdentityModel.Tokens.Jwt;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Billing.GooglePlay;

/// <summary>
/// Verifies a Cloud Pub/Sub push's OIDC token, as Google documents for authenticated push: signed with Google's keys
/// (cached by <see cref="ConfigurationManager{T}"/>), issued by accounts.google.com, for our endpoint's URL, by the
/// push subscription's service account with a verified email. Without both settings nothing is accepted.
/// </summary>
internal sealed class PubSubPushVerifier : IGooglePlayPushVerifier
{
    private const string DiscoveryDocument = "https://accounts.google.com/.well-known/openid-configuration";
    private static readonly string[] ValidIssuers = ["accounts.google.com", "https://accounts.google.com"];

    private readonly GooglePlayOptions _options;
    private readonly ILogger<PubSubPushVerifier> _logger;
    private readonly ConfigurationManager<OpenIdConnectConfiguration> _configuration = new(
        DiscoveryDocument, new OpenIdConnectConfigurationRetriever(), new HttpDocumentRetriever());

    // Claims are read by their JWT names ("email"), so inbound mapping stays off (see GoogleTokenValidator).
    private readonly JwtSecurityTokenHandler _handler = new() { MapInboundClaims = false };

    public PubSubPushVerifier(GooglePlayOptions options, ILogger<PubSubPushVerifier> logger)
    {
        _options = options;
        _logger = logger;
    }

    public async Task<bool> VerifyAsync(string? authorization, CancellationToken ct)
    {
        if (!_options.CanVerifyPushes)
        {
            _logger.LogWarning("Google Play notification refused: GooglePlay__PushAudience and __PushServiceAccount are not set.");
            return false;
        }
        const string prefix = "Bearer ";
        if (authorization is null || !authorization.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return false;

        var config = await _configuration.GetConfigurationAsync(ct);
        return Accepts(authorization[prefix.Length..].Trim(), new TokenValidationParameters
        {
            ValidIssuers = ValidIssuers,
            ValidAudience = _options.PushAudience,
            IssuerSigningKeys = config.SigningKeys,
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        });
    }

    /// <summary>Split from <see cref="VerifyAsync"/> so it can be tried with a locally signed token.</summary>
    internal bool Accepts(string token, TokenValidationParameters parameters)
    {
        try
        {
            var principal = _handler.ValidateToken(token, parameters, out _);
            var email = principal.FindFirst("email")?.Value;
            var verified = principal.FindFirst("email_verified")?.Value;
            return string.Equals(email, _options.PushServiceAccount, StringComparison.OrdinalIgnoreCase)
                   && string.Equals(verified, "true", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is SecurityTokenException or ArgumentException)
        {
            return false;
        }
    }
}
