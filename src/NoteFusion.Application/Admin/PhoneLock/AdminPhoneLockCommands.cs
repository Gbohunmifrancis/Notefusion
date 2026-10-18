using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.PhoneLock;

/// <summary>A code was emailed: name it back with <paramref name="CodeId"/>. <paramref name="SentTo"/> is masked.</summary>
public sealed record AdminCodeSentDto(string CodeId, string SentTo, DateTime ExpiresAtUtc);

/// <summary>An open Admin pass for the phone to send as <c>X-Admin-Session</c>.</summary>
public sealed record AdminPhoneSessionDto(string Session, DateTime ExpiresAtUtc);

/// <summary>
/// This phone's new key: <paramref name="Secret"/> is shown this once, for the phone to keep behind its fingerprint or
/// face; the server keeps only its hash. Comes with an open pass, as the password and code have just been checked.
/// </summary>
public sealed record AdminPhoneSetUpDto(Guid KeyId, string Secret, string Session, DateTime ExpiresAtUtc);

// ── Ask for a code ──────────────────────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Step one of setting Admin up on a phone, and of opening it on a phone with no fingerprint or face sensor: the
/// account password, then a six-digit code to the account's own inbox.
/// </summary>
public sealed record RequestAdminCodeCommand(string Password, string Purpose) : IRequest<Result<AdminCodeSentDto>>;

public sealed class RequestAdminCodeCommandValidator : AbstractValidator<RequestAdminCodeCommand>
{
    public RequestAdminCodeCommandValidator()
    {
        RuleFor(x => x.Password).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Purpose).NotEmpty().MaximumLength(20);
    }
}

public sealed class RequestAdminCodeCommandHandler : IRequestHandler<RequestAdminCodeCommand, Result<AdminCodeSentDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IPasswordHasher _hasher;
    private readonly IAdminPhoneLock _lock;
    private readonly IEmailSender _email;
    private readonly IDateTimeProvider _clock;

    public RequestAdminCodeCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IPasswordHasher hasher, IAdminPhoneLock phoneLock,
        IEmailSender email, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _hasher = hasher;
        _lock = phoneLock;
        _email = email;
        _clock = clock;
    }

    public async Task<Result<AdminCodeSentDto>> Handle(RequestAdminCodeCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;
        if (request.Purpose is not (AdminPhoneLockRules.PurposeSetup or AdminPhoneLockRules.PurposeUnlock))
            return AdminPhoneLockErrors.BadPurpose;

        var now = _clock.UtcNow;
        if (_lock.IsLockedOut(userId, now))
            return AdminPhoneLockErrors.TooManyTries;

        var user = await AdminPassword.CheckAsync(_db, _hasher, userId, request.Password, now, ct);
        if (user.IsFailure)
            return user.Error;

        if (_lock.IssueCode(userId, request.Purpose, now) is not { } code)
            return AdminPhoneLockErrors.TooManyCodes;

        await _email.SendAdminCodeAsync(
            new EmailRecipient(user.Value.Email, user.Value.FullName), code.Code,
            setup: request.Purpose == AdminPhoneLockRules.PurposeSetup, ct);
        return new AdminCodeSentDto(code.CodeId, AdminPhoneLockRules.MaskEmail(user.Value.Email), code.ExpiresAtUtc);
    }
}

// ── Set the phone up ────────────────────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Step two of setting Admin up: the emailed code. Makes this phone's key (retiring <paramref name="ReplacesKeyId"/>,
/// the one a new fingerprint wiped, and any beyond <see cref="AdminPhoneLockRules.MaxKeys"/>), tells the account's
/// inbox, writes the audit log, and opens a pass.
/// </summary>
public sealed record SetUpAdminPhoneCommand(string CodeId, string Code, string? Label, Guid? ReplacesKeyId)
    : IRequest<Result<AdminPhoneSetUpDto>>;

public sealed class SetUpAdminPhoneCommandValidator : AbstractValidator<SetUpAdminPhoneCommand>
{
    public SetUpAdminPhoneCommandValidator()
    {
        RuleFor(x => x.CodeId).NotEmpty().MaximumLength(64);
        RuleFor(x => x.Code).NotEmpty().MaximumLength(12);
        RuleFor(x => x.Label).MaximumLength(80);
    }
}

public sealed class SetUpAdminPhoneCommandHandler : IRequestHandler<SetUpAdminPhoneCommand, Result<AdminPhoneSetUpDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IAdminPhoneLock _lock;
    private readonly ISecureTokenGenerator _tokens;
    private readonly IAuditLogger _audit;
    private readonly IEmailSender _email;
    private readonly IDateTimeProvider _clock;

    public SetUpAdminPhoneCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IAdminPhoneLock phoneLock, ISecureTokenGenerator tokens,
        IAuditLogger audit, IEmailSender email, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _lock = phoneLock;
        _tokens = tokens;
        _audit = audit;
        _email = email;
        _clock = clock;
    }

    public async Task<Result<AdminPhoneSetUpDto>> Handle(SetUpAdminPhoneCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        var now = _clock.UtcNow;
        var check = _lock.CheckCode(userId, request.CodeId, request.Code.Trim(), AdminPhoneLockRules.PurposeSetup, now);
        if (AdminPhoneLockCodes.Refusal(check) is { } refused)
            return refused;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return AdminErrors.NotAuthenticated;

        var secret = _tokens.GenerateToken();
        var key = AdminPhoneKey.Create(userId, AdminPhoneLockRules.Hash(secret), request.Label ?? "", now);
        _db.AdminPhoneKeys.Add(key);

        // The key a new fingerprint wiped, and the oldest beyond the limit: a phone no longer in use keeps no way in.
        var active = await _db.AdminPhoneKeys
            .Where(k => k.UserId == userId && k.RevokedAtUtc == null)
            .OrderByDescending(k => k.CreatedAtUtc)
            .ToListAsync(ct);
        foreach (var (old, index) in active.Select((k, i) => (k, i)))
        {
            if (old.Id == request.ReplacesKeyId || index >= AdminPhoneLockRules.MaxKeys - 1)
                old.Revoke(now);
        }

        _audit.Record(AdminAuditAction.SetUpAdminPhone, user, $"Set Admin up on a phone ({key.Label}).");
        await _db.SaveChangesAsync(ct);

        // If this was not them, this is how they find out.
        await _email.SendAdminPhoneAddedAsync(new EmailRecipient(user.Email, user.FullName), key.Label, now, ct);

        var session = _lock.Open(userId, key.Id, now);
        return new AdminPhoneSetUpDto(key.Id, secret, session.Token, session.ExpiresAtUtc);
    }
}

// ── Unlock with the phone's key ─────────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Opens a pass with this phone's key, which the phone could only read with its owner's fingerprint or face. Also the
/// destructive actions' confirmation: the pass it opens is freshly unlocked, and it replaces <paramref name="Session"/>.
/// </summary>
public sealed record UnlockAdminPhoneCommand(Guid KeyId, string Secret, string? Session = null)
    : IRequest<Result<AdminPhoneSessionDto>>;

public sealed class UnlockAdminPhoneCommandValidator : AbstractValidator<UnlockAdminPhoneCommand>
{
    public UnlockAdminPhoneCommandValidator()
    {
        RuleFor(x => x.KeyId).NotEmpty();
        RuleFor(x => x.Secret).NotEmpty().MaximumLength(200);
    }
}

public sealed class UnlockAdminPhoneCommandHandler : IRequestHandler<UnlockAdminPhoneCommand, Result<AdminPhoneSessionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IAdminPhoneLock _lock;
    private readonly IDateTimeProvider _clock;

    public UnlockAdminPhoneCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IAdminPhoneLock phoneLock, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _lock = phoneLock;
        _clock = clock;
    }

    public async Task<Result<AdminPhoneSessionDto>> Handle(UnlockAdminPhoneCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        var now = _clock.UtcNow;
        if (_lock.IsLockedOut(userId, now))
            return AdminPhoneLockErrors.TooManyTries;

        var key = await _db.AdminPhoneKeys.FirstOrDefaultAsync(
            k => k.Id == request.KeyId && k.UserId == userId && k.RevokedAtUtc == null, ct);
        if (key is null || !AdminPhoneLockRules.Matches(key, request.Secret))
        {
            _lock.RecordFailure(userId, now);
            return AdminPhoneLockErrors.KeyInvalid;
        }

        key.MarkUsed(now);
        await _db.SaveChangesAsync(ct);

        _lock.Close(request.Session);
        var session = _lock.Open(userId, key.Id, now);
        return new AdminPhoneSessionDto(session.Token, session.ExpiresAtUtc);
    }
}

// ── Unlock with an emailed code (no sensor) ─────────────────────────────────────────────────────────────────────

/// <summary>A phone with no fingerprint or face sensor: the code emailed after the password opens a pass.</summary>
public sealed record VerifyAdminCodeCommand(string CodeId, string Code) : IRequest<Result<AdminPhoneSessionDto>>;

public sealed class VerifyAdminCodeCommandValidator : AbstractValidator<VerifyAdminCodeCommand>
{
    public VerifyAdminCodeCommandValidator()
    {
        RuleFor(x => x.CodeId).NotEmpty().MaximumLength(64);
        RuleFor(x => x.Code).NotEmpty().MaximumLength(12);
    }
}

public sealed class VerifyAdminCodeCommandHandler : IRequestHandler<VerifyAdminCodeCommand, Result<AdminPhoneSessionDto>>
{
    private readonly ICurrentUser _caller;
    private readonly IAdminPhoneLock _lock;
    private readonly IDateTimeProvider _clock;

    public VerifyAdminCodeCommandHandler(ICurrentUser caller, IAdminPhoneLock phoneLock, IDateTimeProvider clock)
    {
        _caller = caller;
        _lock = phoneLock;
        _clock = clock;
    }

    public Task<Result<AdminPhoneSessionDto>> Handle(VerifyAdminCodeCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return Task.FromResult<Result<AdminPhoneSessionDto>>(AdminErrors.NotAuthenticated);

        var now = _clock.UtcNow;
        var check = _lock.CheckCode(userId, request.CodeId, request.Code.Trim(), AdminPhoneLockRules.PurposeUnlock, now);
        if (AdminPhoneLockCodes.Refusal(check) is { } refused)
            return Task.FromResult<Result<AdminPhoneSessionDto>>(refused);

        var session = _lock.Open(userId, null, now);
        return Task.FromResult<Result<AdminPhoneSessionDto>>(new AdminPhoneSessionDto(session.Token, session.ExpiresAtUtc));
    }
}

// ── Lock ────────────────────────────────────────────────────────────────────────────────────────────────────────

/// <summary>The phone locked Admin (5 minutes without a tap, sign-out, leaving): its pass ends now, not 5 minutes on.</summary>
public sealed record LockAdminPhoneCommand(string? Session) : IRequest<Result>;

public sealed class LockAdminPhoneCommandHandler : IRequestHandler<LockAdminPhoneCommand, Result>
{
    private readonly IAdminPhoneLock _lock;

    public LockAdminPhoneCommandHandler(IAdminPhoneLock phoneLock) => _lock = phoneLock;

    public Task<Result> Handle(LockAdminPhoneCommand request, CancellationToken ct)
    {
        _lock.Close(request.Session);
        return Task.FromResult(Result.Success());
    }
}

internal static class AdminPhoneLockCodes
{
    public static Error? Refusal(AdminCodeCheck check) => check switch
    {
        AdminCodeCheck.Ok => null,
        AdminCodeCheck.Expired => AdminPhoneLockErrors.CodeExpired,
        AdminCodeCheck.LockedOut => AdminPhoneLockErrors.TooManyTries,
        _ => AdminPhoneLockErrors.CodeWrong,
    };
}
