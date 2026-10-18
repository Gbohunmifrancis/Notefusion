using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.GooglePlay;

/// <summary>
/// OAuth access tokens for the Google Play Developer API, from the service account's key: a JWT signed with its
/// private key is exchanged at Google's token endpoint (the service-account flow), and the token is kept until five
/// minutes before it runs out. One exchange at a time, so a burst of purchases shares one token.
/// </summary>
internal sealed class GooglePlayAccessTokens
{
    public const string HttpClientName = "googleplay-oauth";
    private const string Scope = "https://www.googleapis.com/auth/androidpublisher";
    private const string DefaultTokenUri = "https://oauth2.googleapis.com/token";

    private readonly IHttpClientFactory _httpFactory;
    private readonly GooglePlayOptions _options;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<GooglePlayAccessTokens> _logger;
    private readonly SemaphoreSlim _exchange = new(1, 1);

    private string? _token;
    private DateTime _renewAfterUtc;

    public GooglePlayAccessTokens(
        IHttpClientFactory httpFactory, GooglePlayOptions options, IDateTimeProvider clock, ILogger<GooglePlayAccessTokens> logger)
    {
        _httpFactory = httpFactory;
        _options = options;
        _clock = clock;
        _logger = logger;
    }

    public async Task<Result<string>> GetAsync(CancellationToken ct)
    {
        if (_token is { } cached && _clock.UtcNow < _renewAfterUtc)
            return cached;

        await _exchange.WaitAsync(ct);
        try
        {
            if (_token is { } fresh && _clock.UtcNow < _renewAfterUtc)
                return fresh;

            if (ServiceAccountKey.Read(_options.ServiceAccountJsonText()) is not { } key)
            {
                _logger.LogError("GooglePlay__ServiceAccountJson is not a service account key (client_email and private_key).");
                return BillingErrors.PlayNotConfigured;
            }

            var now = _clock.UtcNow;
            var client = _httpFactory.CreateClient(HttpClientName);
            using var response = await client.PostAsync(key.TokenUri, new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                ["assertion"] = Assertion(key, now),
            }), ct);
            var raw = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Google token exchange refused: {Status} {Error}", (int)response.StatusCode, ReadString(raw, "error"));
                return BillingErrors.PlayUnavailable;
            }

            var token = ReadString(raw, "access_token");
            if (string.IsNullOrEmpty(token))
                return BillingErrors.PlayUnavailable;
            var lifetime = ReadInt(raw, "expires_in") ?? 3600;
            _token = token;
            _renewAfterUtc = now.AddSeconds(Math.Max(60, lifetime - 300));
            return token;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning("Could not reach Google's token endpoint: {Message}", ex.Message);
            return BillingErrors.PlayUnavailable;
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            return BillingErrors.PlayUnavailable;
        }
        finally
        {
            _exchange.Release();
        }
    }

    /// <summary>The signed request for a token: issued by the service account, for the androidpublisher scope.</summary>
    internal static string Assertion(ServiceAccountKey key, DateTime nowUtc)
    {
        using var rsa = RSA.Create();
        rsa.ImportFromPem(key.PrivateKey);
        // No cached signature provider: it would outlive this RSA instance.
        var signingKey = new RsaSecurityKey(rsa) { CryptoProviderFactory = new CryptoProviderFactory { CacheSignatureProviders = false } };
        var issuedAt = new DateTimeOffset(nowUtc).ToUnixTimeSeconds();
        var jwt = new JwtSecurityToken(
            issuer: key.ClientEmail,
            audience: key.TokenUri,
            claims:
            [
                new Claim("scope", Scope),
                new Claim(JwtRegisteredClaimNames.Iat, issuedAt.ToString(), ClaimValueTypes.Integer64),
            ],
            expires: nowUtc.AddMinutes(60),
            signingCredentials: new SigningCredentials(signingKey, SecurityAlgorithms.RsaSha256));
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }

    private static string? ReadString(string json, string name)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static int? ReadInt(string json, string name)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>The three fields of a service account's JSON key this flow uses.</summary>
    internal sealed record ServiceAccountKey(string ClientEmail, string PrivateKey, string TokenUri)
    {
        public static ServiceAccountKey? Read(string json)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                string? Field(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                var email = Field("client_email");
                var privateKey = Field("private_key");
                if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(privateKey))
                    return null;
                return new ServiceAccountKey(email, privateKey, Field("token_uri") ?? DefaultTokenUri);
            }
            catch (JsonException)
            {
                return null;
            }
        }
    }
}
