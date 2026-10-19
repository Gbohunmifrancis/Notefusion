using System.Text.Json;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Passkeys;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.PhoneLock;

// The admin console's lock (board i-console-lock): the same pass, rules and refusals as the phone's
// (AdminPhoneLockRules), opened with one of the admin's own passkeys or the account password instead of a phone key.
// Each unlock opens a new pass that also counts as a fresh confirmation, which is how the console confirms Suspend,
// End subscription, Revoke Pro, Change role, a feature flag and adding or removing a passkey.

// ── With a passkey ──────────────────────────────────────────────────────────────────────────────────────────────

/// <summary>Assertion options for unlocking the console with a passkey, bound to the admin asking.</summary>
public sealed record BeginConsoleUnlockCommand : IRequest<Result<JsonElement>>;

public sealed class BeginConsoleUnlockCommandHandler : IRequestHandler<BeginConsoleUnlockCommand, Result<JsonElement>>
{
    private readonly ICurrentUser _caller;
    private readonly IPasskeyCeremony _ceremony;
    private readonly IPasskeyChallengeStore _challenges;
    private readonly IDateTimeProvider _clock;

    public BeginConsoleUnlockCommandHandler(
        ICurrentUser caller, IPasskeyCeremony ceremony, IPasskeyChallengeStore challenges, IDateTimeProvider clock)
    {
        _caller = caller;
        _ceremony = ceremony;
        _challenges = challenges;
        _clock = clock;
    }

    public Task<Result<JsonElement>> Handle(BeginConsoleUnlockCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return Task.FromResult<Result<JsonElement>>(AdminErrors.NotAuthenticated);

        // The sign-in options (user verification required); the challenge is what binds them to this admin.
        var options = _ceremony.CreateSignInOptions();
        _challenges.Save(new PasskeyChallenge(
            options.Challenge, PasskeyCeremonyKind.Unlock, userId, options.OptionsJson,
            _clock.UtcNow + PasskeyChallenge.Lifetime));

        return Task.FromResult<Result<JsonElement>>(PasskeyJson.Parse(options.OptionsJson));
    }
}

/// <summary>
/// Opens a console pass with the browser's assertion: <c>{ credential }</c>, answering options from
/// <see cref="BeginConsoleUnlockCommand"/>, made with one of the caller's own passkeys. <paramref name="Session"/> is the
/// pass it replaces, if any.
/// </summary>
public sealed record UnlockConsoleWithPasskeyCommand(JsonElement Credential, string? Session = null)
    : IRequest<Result<AdminPhoneSessionDto>>;

public sealed class UnlockConsoleWithPasskeyCommandHandler
    : IRequestHandler<UnlockConsoleWithPasskeyCommand, Result<AdminPhoneSessionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IPasskeyCeremony _ceremony;
    private readonly IPasskeyChallengeStore _challenges;
    private readonly IAdminPhoneLock _lock;
    private readonly IDateTimeProvider _clock;

    public UnlockConsoleWithPasskeyCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IPasskeyCeremony ceremony, IPasskeyChallengeStore challenges,
        IAdminPhoneLock passes, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _ceremony = ceremony;
        _challenges = challenges;
        _lock = passes;
        _clock = clock;
    }

    public async Task<Result<AdminPhoneSessionDto>> Handle(UnlockConsoleWithPasskeyCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        if (PasskeyJson.Raw(request.Credential) is not { } responseJson
            || _ceremony.ReadResponse(responseJson) is not { } claim)
            return PasskeyErrors.SignInFailed;

        // Spent first, whatever happens next; options issued for a sign-in, or to another admin, are not these.
        var challenge = _challenges.Take(claim.Challenge);
        if (challenge is null || challenge.Kind != PasskeyCeremonyKind.Unlock || challenge.UserId != userId)
            return PasskeyErrors.SignInExpired;

        // Only the caller's own passkey: another admin's, even a valid one, does not unlock this account's console.
        var credentialId = claim.CredentialId;
        var passkey = await _db.Passkeys.FirstOrDefaultAsync(p => p.CredentialId == credentialId && p.UserId == userId, ct);
        if (passkey is null)
            return PasskeyErrors.UnknownPasskey;

        var stored = new StoredPasskey(
            passkey.CredentialId, passkey.PublicKey, (uint)passkey.SignCount, passkey.UserId.ToByteArray());
        if (await _ceremony.VerifySignInAsync(responseJson, challenge.OptionsJson, stored, ct) is not { } counter)
            return PasskeyErrors.SignInFailed;

        var now = _clock.UtcNow;
        passkey.RecordUse(counter, now);
        await _db.SaveChangesAsync(ct);

        _lock.Close(request.Session);
        var session = _lock.Open(userId, null, now);
        return new AdminPhoneSessionDto(session.Token, session.ExpiresAtUtc);
    }
}

// ── With the password ───────────────────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Opens a console pass with the account password, for a computer with no passkey. The sign-in form's lockout applies
/// (<see cref="AdminPassword"/>), so it is no way round it.
/// </summary>
public sealed record UnlockConsoleWithPasswordCommand(string Password, string? Session = null)
    : IRequest<Result<AdminPhoneSessionDto>>;

public sealed class UnlockConsoleWithPasswordCommandValidator : AbstractValidator<UnlockConsoleWithPasswordCommand>
{
    public UnlockConsoleWithPasswordCommandValidator()
    {
        RuleFor(x => x.Password).NotEmpty().MaximumLength(200);
    }
}

public sealed class UnlockConsoleWithPasswordCommandHandler
    : IRequestHandler<UnlockConsoleWithPasswordCommand, Result<AdminPhoneSessionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IPasswordHasher _hasher;
    private readonly IAdminPhoneLock _lock;
    private readonly IDateTimeProvider _clock;
    private readonly IQuotaGate _gate;

    public UnlockConsoleWithPasswordCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IPasswordHasher hasher, IAdminPhoneLock passes,
        IDateTimeProvider clock, IQuotaGate gate)
    {
        _db = db;
        _caller = caller;
        _hasher = hasher;
        _lock = passes;
        _clock = clock;
        _gate = gate;
    }

    public async Task<Result<AdminPhoneSessionDto>> Handle(UnlockConsoleWithPasswordCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        // One guess at a time per account, sharing the sign-in form's count (QuotaGateExtensions.SignInKey).
        var email = await _db.Users.Where(u => u.Id == userId).Select(u => u.Email).FirstOrDefaultAsync(ct);
        if (email is null)
            return AdminErrors.NotAuthenticated;
        await using var lease = await _gate.AcquireAsync(QuotaGateExtensions.SignInKey(email), ct);

        var now = _clock.UtcNow;
        var user = await AdminPassword.CheckAsync(_db, _hasher, userId, request.Password, now, ct);
        if (user.IsFailure)
            return user.Error;

        _lock.Close(request.Session);
        var session = _lock.Open(userId, null, now);
        return new AdminPhoneSessionDto(session.Token, session.ExpiresAtUtc);
    }
}
