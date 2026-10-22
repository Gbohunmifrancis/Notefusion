using NoteFusion.Application.Activity;
using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Auth.Services;

/// <inheritdoc />
public sealed class TokenIssuer : ITokenIssuer
{
    private readonly IJwtTokenService _jwt;
    private readonly ISecureTokenGenerator _tokenGenerator;
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly AuthSettings _settings;
    private readonly IClientApp? _clientApp;

    public TokenIssuer(
        IJwtTokenService jwt,
        ISecureTokenGenerator tokenGenerator,
        IApplicationDbContext db,
        IDateTimeProvider clock,
        AuthSettings settings,
        IClientApp? clientApp = null)
    {
        _jwt = jwt;
        _tokenGenerator = tokenGenerator;
        _db = db;
        _clock = clock;
        _settings = settings;
        _clientApp = clientApp;
    }

    public TokenPairResponse Issue(User user, string? client = null)
    {
        client ??= _clientApp?.Current;
        var access = _jwt.GenerateAccessToken(user, client);

        var secret = _tokenGenerator.GenerateToken();
        var now = _clock.UtcNow;
        var refreshToken = RefreshToken.Issue(
            user.Id,
            RefreshTokenSecrets.Hash(secret),
            now,
            now.AddDays(_settings.RefreshTokenDays),
            client);

        _db.RefreshTokens.Add(refreshToken);

        // The plain refresh token embeds its row id so it can be looked up on refresh
        // (the stored hash is not itself queryable). Only the secret half is hashed.
        var plainRefresh = CompositeTokenCodec.Compose(refreshToken.Id, secret);
        return new TokenPairResponse(access.Value, plainRefresh, access.ExpiresInSeconds);
    }

    public TokenPairResponse IssueForSignIn(User user, string method, bool newAccount = false)
    {
        var tokens = Issue(user);
        var client = ActivityClient.From(_clientApp?.Current);
        var detail = $"method={method}";
        if (newAccount)
            _db.UserActivities.Add(UserActivity.Record(user.Id, UserActivity.SignUp, detail, client, _clock.UtcNow));
        _db.UserActivities.Add(UserActivity.Record(user.Id, UserActivity.SignIn, detail, client, _clock.UtcNow));
        return tokens;
    }
}
