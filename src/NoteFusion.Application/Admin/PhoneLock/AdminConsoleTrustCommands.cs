using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.PhoneLock;

// A browser the console remembers (AdminTrustedBrowser): asked for right after an unlock or a sign-in, while the pass is
// still a fresh confirmation, and later traded for a pass whenever the console finds itself locked (a reload, a new tab,
// the hour, an API restart). That pass is never fresh, so Suspend, End subscription, Revoke Pro, Change role, flags and
// passkeys still ask for the passkey or password.

public sealed record ConsoleTrustDto(string Token, DateTime ExpiresAtUtc);

public sealed record TrustedBrowserDto(
    Guid Id, string Label, DateTime CreatedAtUtc, DateTime LastUsedAtUtc, DateTime ExpiresAtUtc, bool ThisBrowser);

public static class AdminConsoleTrustErrors
{
    public static readonly Error NotFresh = Error.Forbidden(
        "ADMIN_CONFIRM_REQUIRED", "Unlock with your passkey or password first, then this browser can be remembered.");

    public static readonly Error Invalid = Error.Forbidden(
        "ADMIN_TRUST_INVALID", "This browser is no longer remembered. Unlock with your passkey or password.");
}

/// <summary>Remembers this browser for <see cref="AdminTrustedBrowser.Lifetime"/>; wants a pass opened in the last minute.</summary>
public sealed record RememberConsoleBrowserCommand(string? Session, string? Label) : IRequest<Result<ConsoleTrustDto>>;

public sealed class RememberConsoleBrowserCommandHandler : IRequestHandler<RememberConsoleBrowserCommand, Result<ConsoleTrustDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IAdminPhoneLock _lock;
    private readonly IDateTimeProvider _clock;

    public RememberConsoleBrowserCommandHandler(IApplicationDbContext db, ICurrentUser caller, IAdminPhoneLock passes, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _lock = passes;
        _clock = clock;
    }

    public async Task<Result<ConsoleTrustDto>> Handle(RememberConsoleBrowserCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;
        var now = _clock.UtcNow;
        // Only the admin who just proved it is them: a pass opened by a remembered browser cannot remember another.
        if (_lock.Touch(request.Session, userId, now) is not { } session || now - session.UnlockedAtUtc > AdminPhoneLockRules.FreshFor)
            return AdminConsoleTrustErrors.NotFresh;

        var token = AdminConsoleTrust.NewToken();
        var browser = AdminTrustedBrowser.Create(userId, AdminPhoneLockRules.Hash(token), request.Label, now);
        _db.AdminTrustedBrowsers.Add(browser);

        // At most MaxPerAdmin: the least recently used beyond that are forgotten.
        var active = await _db.AdminTrustedBrowsers
            .Where(b => b.UserId == userId && b.RevokedAtUtc == null && b.ExpiresAtUtc > now)
            .OrderByDescending(b => b.LastUsedAtUtc).ToListAsync(ct);
        foreach (var old in active.Skip(AdminTrustedBrowser.MaxPerAdmin - 1))
            old.Revoke(now);

        await _db.SaveChangesAsync(ct);
        return new ConsoleTrustDto(token, browser.ExpiresAtUtc);
    }
}

/// <summary>A remembered browser's token traded for a pass (not a fresh one); <paramref name="Session"/> is the pass it replaces.</summary>
public sealed record OpenConsoleFromTrustedBrowserCommand(string? Token, string? Session = null) : IRequest<Result<AdminPhoneSessionDto>>;

public sealed class OpenConsoleFromTrustedBrowserCommandHandler
    : IRequestHandler<OpenConsoleFromTrustedBrowserCommand, Result<AdminPhoneSessionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IAdminPhoneLock _lock;
    private readonly IDateTimeProvider _clock;

    public OpenConsoleFromTrustedBrowserCommandHandler(IApplicationDbContext db, ICurrentUser caller, IAdminPhoneLock passes, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _lock = passes;
        _clock = clock;
    }

    public async Task<Result<AdminPhoneSessionDto>> Handle(OpenConsoleFromTrustedBrowserCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;
        if (string.IsNullOrWhiteSpace(request.Token) || request.Token.Length > AdminConsoleTrust.MaxTokenLength)
            return AdminConsoleTrustErrors.Invalid;
        var now = _clock.UtcNow;
        var hash = AdminPhoneLockRules.Hash(request.Token);
        // Only this admin's own: another admin's token, even a live one, opens nothing for this account.
        var browser = await _db.AdminTrustedBrowsers.FirstOrDefaultAsync(b => b.TokenHash == hash && b.UserId == userId, ct);
        if (browser is null || !browser.IsActiveAt(now) || _lock.IsLockedOut(userId, now))
            return AdminConsoleTrustErrors.Invalid;

        browser.MarkUsed(now);
        await _db.SaveChangesAsync(ct);
        _lock.Close(request.Session);
        var session = _lock.Open(userId, null, now, fresh: false);
        return new AdminPhoneSessionDto(session.Token, session.ExpiresAtUtc);
    }
}

/// <summary>Forgets a remembered browser: by its token (this browser, at sign-out) or by its id (from Settings).</summary>
public sealed record ForgetConsoleBrowserCommand(string? Token = null, Guid? Id = null) : IRequest<Result>;

public sealed class ForgetConsoleBrowserCommandHandler : IRequestHandler<ForgetConsoleBrowserCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IDateTimeProvider _clock;

    public ForgetConsoleBrowserCommandHandler(IApplicationDbContext db, ICurrentUser caller, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _clock = clock;
    }

    public async Task<Result> Handle(ForgetConsoleBrowserCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;
        var hash = string.IsNullOrWhiteSpace(request.Token) || request.Token.Length > AdminConsoleTrust.MaxTokenLength
            ? null : AdminPhoneLockRules.Hash(request.Token);
        if (hash is null && request.Id is null)
            return Result.Success();
        var browser = await _db.AdminTrustedBrowsers.FirstOrDefaultAsync(
            b => b.UserId == userId && (hash != null ? b.TokenHash == hash : b.Id == request.Id), ct);
        if (browser is null)
            return Result.Success();   // already gone: forgetting is idempotent
        browser.Revoke(_clock.UtcNow);
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}

/// <summary>The caller's remembered browsers, most recently used first; <paramref name="Token"/> marks this one.</summary>
public sealed record GetConsoleBrowsersQuery(string? Token = null) : IRequest<Result<IReadOnlyList<TrustedBrowserDto>>>;

public sealed class GetConsoleBrowsersQueryHandler : IRequestHandler<GetConsoleBrowsersQuery, Result<IReadOnlyList<TrustedBrowserDto>>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IDateTimeProvider _clock;

    public GetConsoleBrowsersQueryHandler(IApplicationDbContext db, ICurrentUser caller, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _clock = clock;
    }

    public async Task<Result<IReadOnlyList<TrustedBrowserDto>>> Handle(GetConsoleBrowsersQuery request, CancellationToken ct)
    {
        if (_caller.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;
        var now = _clock.UtcNow;
        var hash = string.IsNullOrWhiteSpace(request.Token) || request.Token.Length > AdminConsoleTrust.MaxTokenLength
            ? null : AdminPhoneLockRules.Hash(request.Token);
        var rows = await _db.AdminTrustedBrowsers
            .Where(b => b.UserId == userId && b.RevokedAtUtc == null && b.ExpiresAtUtc > now)
            .OrderByDescending(b => b.LastUsedAtUtc).ToListAsync(ct);
        return rows.Select(b => new TrustedBrowserDto(b.Id, b.Label, b.CreatedAtUtc, b.LastUsedAtUtc, b.ExpiresAtUtc, b.TokenHash == hash))
            .ToList();
    }
}

public static class AdminConsoleTrust
{
    /// <summary>A token is 43 characters (256 bits, base64url); anything much longer is not one.</summary>
    public const int MaxTokenLength = 128;

    public static string NewToken()
        => Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
