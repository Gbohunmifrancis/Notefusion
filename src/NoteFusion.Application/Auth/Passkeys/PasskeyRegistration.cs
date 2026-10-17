using System.Text.Json;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Passkeys;

/// <summary>
/// Step one of adding a passkey: creation options for the signed-in admin (resident key and user
/// verification required, their existing passkeys excluded), returned as WebAuthn JSON for
/// <c>navigator.credentials.create</c>. The challenge is held server-side for <see cref="PasskeyChallenge.Lifetime"/>.
/// </summary>
public sealed record BeginPasskeyRegistrationCommand : IRequest<Result<JsonElement>>;

public sealed class BeginPasskeyRegistrationCommandHandler
    : IRequestHandler<BeginPasskeyRegistrationCommand, Result<JsonElement>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IPasskeyCeremony _ceremony;
    private readonly IPasskeyChallengeStore _challenges;
    private readonly IDateTimeProvider _clock;

    public BeginPasskeyRegistrationCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IPasskeyCeremony ceremony,
        IPasskeyChallengeStore challenges, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _ceremony = ceremony;
        _challenges = challenges;
        _clock = clock;
    }

    public async Task<Result<JsonElement>> Handle(BeginPasskeyRegistrationCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return UserErrors.NotFound;

        // The route is behind the Admin policy already; this is the same rule read from the row, so a
        // handler reached some other way cannot hand a passkey to a non-admin.
        if (user.Role != UserRole.Admin || !user.IsActive)
            return PasskeyErrors.AdminOnly;

        var existing = await _db.Passkeys.AsNoTracking()
            .Where(p => p.UserId == userId)
            .Select(p => p.CredentialId)
            .ToListAsync(ct);

        var options = _ceremony.CreateRegistrationOptions(
            new PasskeyUser(user.Id, user.Email, string.IsNullOrWhiteSpace(user.FullName) ? user.Email : user.FullName),
            existing);

        _challenges.Save(new PasskeyChallenge(
            options.Challenge, PasskeyCeremonyKind.Registration, userId, options.OptionsJson,
            _clock.UtcNow + PasskeyChallenge.Lifetime));

        return PasskeyJson.Parse(options.OptionsJson);
    }
}

/// <summary>
/// Step two: the browser's attestation response (the <c>PublicKeyCredential</c> as WebAuthn JSON) and the
/// name the admin gave it. Verified against the options issued to this same admin, then stored.
/// </summary>
public sealed record CompletePasskeyRegistrationCommand(JsonElement Credential, string? Name)
    : IRequest<Result<PasskeyDto>>;

public sealed class CompletePasskeyRegistrationCommandValidator : AbstractValidator<CompletePasskeyRegistrationCommand>
{
    public CompletePasskeyRegistrationCommandValidator()
    {
        RuleFor(x => x.Name).MaximumLength(Passkey.NameMaxLength)
            .WithMessage($"Keep the name to {Passkey.NameMaxLength} characters or fewer.");
    }
}

public sealed class CompletePasskeyRegistrationCommandHandler
    : IRequestHandler<CompletePasskeyRegistrationCommand, Result<PasskeyDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IPasskeyCeremony _ceremony;
    private readonly IPasskeyChallengeStore _challenges;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public CompletePasskeyRegistrationCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IPasskeyCeremony ceremony,
        IPasskeyChallengeStore challenges, IAuditLogger audit, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _ceremony = ceremony;
        _challenges = challenges;
        _audit = audit;
        _clock = clock;
    }

    public async Task<Result<PasskeyDto>> Handle(CompletePasskeyRegistrationCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return UserErrors.NotFound;
        if (user.Role != UserRole.Admin || !user.IsActive)
            return PasskeyErrors.AdminOnly;

        if (PasskeyJson.Raw(request.Credential) is not { } responseJson
            || _ceremony.ReadResponse(responseJson) is not { } claim)
            return PasskeyErrors.RegistrationFailed;

        // Taken before anything else can fail, so the options are spent whatever happens next. Options issued
        // for a sign-in, or to another admin, are not these options.
        var challenge = _challenges.Take(claim.Challenge);
        if (challenge is null || challenge.Kind != PasskeyCeremonyKind.Registration || challenge.UserId != userId)
            return PasskeyErrors.RegistrationExpired;

        var verified = await _ceremony.VerifyRegistrationAsync(responseJson, challenge.OptionsJson, ct);
        if (verified is null)
            return PasskeyErrors.RegistrationFailed;

        var credentialId = verified.CredentialId;
        if (await _db.Passkeys.AnyAsync(p => p.CredentialId == credentialId, ct))
            return PasskeyErrors.AlreadyRegistered;

        var passkey = Passkey.Register(
            userId, verified.CredentialId, verified.PublicKey, verified.SignCount, verified.AaGuid,
            verified.Transports, request.Name, _clock.UtcNow);
        _db.Passkeys.Add(passkey);

        _audit.Record(AdminAuditAction.AddPasskey, user, $"Added the passkey \"{passkey.Name}\".");
        await _db.SaveChangesAsync(ct);

        return PasskeyDto.From(passkey);
    }
}

/// <summary>JSON plumbing shared by the passkey handlers.</summary>
internal static class PasskeyJson
{
    public static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    /// <summary>The credential object's raw text, or null when the body carried none.</summary>
    public static string? Raw(JsonElement credential)
        => credential.ValueKind == JsonValueKind.Object ? credential.GetRawText() : null;
}
