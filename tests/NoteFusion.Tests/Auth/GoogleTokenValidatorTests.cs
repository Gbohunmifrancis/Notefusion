using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Infrastructure.Security;

namespace NoteFusion.Tests.Auth;

/// <summary>
/// The real validator, driven with a locally signed token instead of Google's live signing keys.
/// Every other Google test stubs <c>IGoogleTokenValidator</c>, which is why a token could pass
/// signature, issuer and audience and still be discarded on the claim read for two years without
/// a single failing test — the caller only ever sees "the token is invalid or expired", which
/// points at Google rather than at us.
/// </summary>
public class GoogleTokenValidatorTests
{
    private const string Audience = "21738378819-web.apps.googleusercontent.com";
    private const string Issuer = "https://accounts.google.com";

    [Fact]
    public void Reads_the_oidc_claim_names_off_a_valid_token()
    {
        using var rsa = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa);
        var token = Sign(key,
            new Claim("sub", "102938475601928374650"),
            new Claim("email", "ada@example.com"),
            new Claim("email_verified", "true", ClaimValueTypes.Boolean),
            new Claim("name", "Ada Lovelace"),
            new Claim("picture", "https://lh3.googleusercontent.com/a/ada"));

        var identity = Validator().ReadIdentity(token, Parameters(key));

        // A null here is the regression: JwtSecurityTokenHandler renames 'sub' and 'email' to
        // legacy WS-* URIs unless MapInboundClaims is off, so the validator finds neither on a
        // token that is otherwise entirely valid.
        Assert.NotNull(identity);
        Assert.Equal("102938475601928374650", identity.SubjectId);
        Assert.Equal("ada@example.com", identity.Email);
        Assert.Equal("Ada Lovelace", identity.FullName);
        Assert.Equal("https://lh3.googleusercontent.com/a/ada", identity.PictureUrl);
    }

    [Fact]
    public void Reads_email_verified_as_the_json_boolean_google_actually_sends()
    {
        using var rsa = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa);

        // Google sends a JSON boolean, not the string "true", and the handler renders it back as
        // "True" — so a case-sensitive comparison would report every verified account unverified
        // and GoogleSignInCommand would reject all of them.
        var verified = Validator().ReadIdentity(
            Sign(key, Sub(), Email(), new Claim("email_verified", "true", ClaimValueTypes.Boolean)),
            Parameters(key));
        var unverified = Validator().ReadIdentity(
            Sign(key, Sub(), Email(), new Claim("email_verified", "false", ClaimValueTypes.Boolean)),
            Parameters(key));

        Assert.True(verified!.EmailVerified);
        Assert.False(unverified!.EmailVerified);
    }

    [Fact]
    public void Rejects_a_token_signed_by_the_wrong_key()
    {
        using var google = RSA.Create(2048);
        using var impostor = RSA.Create(2048);
        var token = Sign(new RsaSecurityKey(impostor), Sub(), Email());

        Assert.Null(Validator().ReadIdentity(token, Parameters(new RsaSecurityKey(google))));
    }

    [Fact]
    public void Rejects_a_token_for_another_client()
    {
        using var rsa = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa);
        var token = Sign(key, "someone-elses-client.apps.googleusercontent.com", Sub(), Email());

        Assert.Null(Validator().ReadIdentity(token, Parameters(key)));
    }

    [Fact]
    public void Rejects_an_expired_token()
    {
        using var rsa = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa);
        var expired = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            Issuer, Audience, new[] { Sub(), Email() },
            DateTime.UtcNow.AddHours(-2), DateTime.UtcNow.AddHours(-1),
            new SigningCredentials(key, SecurityAlgorithms.RsaSha256)));

        Assert.Null(Validator().ReadIdentity(expired, Parameters(key)));
    }

    [Fact]
    public void Rejects_a_token_with_no_email_claim()
    {
        using var rsa = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa);

        // Nothing downstream can work without it: GoogleSignInCommand matches the account by email.
        Assert.Null(Validator().ReadIdentity(Sign(key, Sub()), Parameters(key)));
    }

    private static Claim Sub() => new("sub", "102938475601928374650");

    private static Claim Email() => new("email", "ada@example.com");

    private static GoogleTokenValidator Validator() =>
        new(new GoogleSettings { ClientId = Audience });

    private static string Sign(SecurityKey key, params Claim[] claims) => Sign(key, Audience, claims);

    private static string Sign(SecurityKey key, string audience, params Claim[] claims) =>
        new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            Issuer, audience, claims, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddHours(1),
            new SigningCredentials(key, SecurityAlgorithms.RsaSha256)));

    private static TokenValidationParameters Parameters(SecurityKey signingKey) => new()
    {
        ValidIssuers = new[] { "accounts.google.com", Issuer },
        ValidAudiences = new[] { Audience },
        IssuerSigningKeys = new[] { signingKey },
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ClockSkew = TimeSpan.FromMinutes(1)
    };
}
