using System.Text.Json;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Passkeys;

/// <summary>
/// Assertion options for a passkey sign-in. Anonymous and discoverable: no email and no allow list, so the
/// browser offers whichever NoteFusion passkey the device holds.
/// </summary>
public sealed record BeginPasskeySignInCommand : IRequest<Result<JsonElement>>;

public sealed class BeginPasskeySignInCommandHandler : IRequestHandler<BeginPasskeySignInCommand, Result<JsonElement>>
{
    private readonly IPasskeyCeremony _ceremony;
    private readonly IPasskeyChallengeStore _challenges;
    private readonly IDateTimeProvider _clock;

    public BeginPasskeySignInCommandHandler(
        IPasskeyCeremony ceremony, IPasskeyChallengeStore challenges, IDateTimeProvider clock)
    {
        _ceremony = ceremony;
        _challenges = challenges;
        _clock = clock;
    }

    public Task<Result<JsonElement>> Handle(BeginPasskeySignInCommand request, CancellationToken ct)
    {
        var options = _ceremony.CreateSignInOptions();
        _challenges.Save(new PasskeyChallenge(
            options.Challenge, PasskeyCeremonyKind.SignIn, null, options.OptionsJson,
            _clock.UtcNow + PasskeyChallenge.Lifetime));

        return Task.FromResult<Result<JsonElement>>(PasskeyJson.Parse(options.OptionsJson));
    }
}

/// <summary>
/// Signs in with a passkey: the browser's assertion (WebAuthn JSON). Verified against the options issued
/// and the stored key (signature, user verification, counter moving forward), then answered with the same
/// token pair the password login returns — but only for an admin account, since passkeys are an
/// admin-console feature for now.
/// </summary>
/// <remarks>
/// Password lockout is not consulted: it counts wrong passwords, and a verified passkey is not a guess.
/// A suspended account is refused as it is everywhere else.
/// </remarks>
public sealed record PasskeySignInCommand(JsonElement Credential) : IRequest<Result<LoginResponse>>;

public sealed class PasskeySignInCommandHandler : IRequestHandler<PasskeySignInCommand, Result<LoginResponse>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasskeyCeremony _ceremony;
    private readonly IPasskeyChallengeStore _challenges;
    private readonly ITokenIssuer _tokenIssuer;
    private readonly IClientIpAddress _clientIp;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<PasskeySignInCommandHandler> _logger;

    public PasskeySignInCommandHandler(
        IApplicationDbContext db, IPasskeyCeremony ceremony, IPasskeyChallengeStore challenges,
        ITokenIssuer tokenIssuer, IClientIpAddress clientIp, IDateTimeProvider clock,
        ILogger<PasskeySignInCommandHandler> logger)
    {
        _db = db;
        _ceremony = ceremony;
        _challenges = challenges;
        _tokenIssuer = tokenIssuer;
        _clientIp = clientIp;
        _clock = clock;
        _logger = logger;
    }

    public async Task<Result<LoginResponse>> Handle(PasskeySignInCommand request, CancellationToken ct)
    {
        if (PasskeyJson.Raw(request.Credential) is not { } responseJson
            || _ceremony.ReadResponse(responseJson) is not { } claim)
            return PasskeyErrors.SignInFailed;

        // Spent first, whatever happens next: an assertion can answer its options once.
        var challenge = _challenges.Take(claim.Challenge);
        if (challenge is null || challenge.Kind != PasskeyCeremonyKind.SignIn)
            return PasskeyErrors.SignInExpired;

        var credentialId = claim.CredentialId;
        var passkey = await _db.Passkeys.FirstOrDefaultAsync(p => p.CredentialId == credentialId, ct);
        if (passkey is null)
            return PasskeyErrors.UnknownPasskey;

        var stored = new StoredPasskey(
            passkey.CredentialId, passkey.PublicKey, (uint)passkey.SignCount, passkey.UserId.ToByteArray());
        var signCount = await _ceremony.VerifySignInAsync(responseJson, challenge.OptionsJson, stored, ct);
        if (signCount is not { } counter)
            return PasskeyErrors.SignInFailed;

        // Verified: the counter moves whoever the account turns out to be, so this assertion cannot be
        // replayed against it even where no token is issued.
        var now = _clock.UtcNow;
        passkey.RecordUse(counter, now);

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == passkey.UserId, ct);
        if (user is null)
            return PasskeyErrors.UnknownPasskey;

        if (user.Role != UserRole.Admin)
        {
            await _db.SaveChangesAsync(ct);
            _logger.LogWarning("Passkey sign-in refused: account {UserId} is not an admin.", user.Id);
            return PasskeyErrors.NotAnAdmin;
        }

        if (!user.IsActive)
        {
            await _db.SaveChangesAsync(ct);
            return AuthErrors.AccountInactive;
        }

        user.RecordSuccessfulLogin(now);
        var tokens = _tokenIssuer.IssueForSignIn(user, "passkey");

        // The audit logger reads its actor from the request's token, and this request has none yet: the
        // account signing in is the actor and the target.
        _db.AdminAuditLogs.Add(AdminAuditLog.Record(
            user.Id, user.Email, AdminAuditAction.PasskeySignIn, user.Id, user.Email, _clientIp.Current,
            $"Signed in to the console with the passkey \"{passkey.Name}\".", null, now));

        await _db.SaveChangesAsync(ct);

        return new LoginResponse(
            tokens.AccessToken,
            tokens.RefreshToken,
            tokens.ExpiresIn,
            new AuthUserDto(user.Id, user.FullName, user.Email, user.Role.ToString()));
    }
}
