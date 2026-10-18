using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Security;

/// <summary>
/// Signs RS256 access tokens. Claims are kept minimal — subject, email, name, role — so the API can
/// authorize from the token alone without a database round-trip on every request.
/// </summary>
public sealed class JwtTokenService : IJwtTokenService
{
    private readonly RsaKeyProvider _keys;
    private readonly JwtSettings _jwt;
    private readonly AuthSettings _auth;

    public JwtTokenService(RsaKeyProvider keys, JwtSettings jwt, AuthSettings auth)
    {
        _keys = keys;
        _jwt = jwt;
        _auth = auth;
    }

    public AccessToken GenerateAccessToken(User user, string? client = null)
    {
        var now = DateTime.UtcNow;
        var expires = now.AddMinutes(_auth.AccessTokenMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(JwtRegisteredClaimNames.Name, user.FullName),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            new(ClaimTypes.Role, user.Role.ToString())
        };
        if (client is not null)
            claims.Add(new Claim(ClientKinds.Claim, client));

        var token = new JwtSecurityToken(
            issuer: _jwt.Issuer,
            audience: _jwt.Audience,
            claims: claims,
            notBefore: now,
            expires: expires,
            signingCredentials: _keys.SigningCredentials);

        var value = new JwtSecurityTokenHandler().WriteToken(token);
        return new AccessToken(value, _auth.AccessTokenMinutes * 60, expires);
    }
}
