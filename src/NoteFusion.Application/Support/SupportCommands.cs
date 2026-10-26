using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.ConsoleAlerts;
using NoteFusion.Application.Admin.PaymentAlerts;
using NoteFusion.Application.Admin.PhoneLock;
using NoteFusion.Application.Analytics;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Support;

// Live support: a customer's thread (the chat widget on the website, the web app and the phone) and the admin console
// that answers it. A signed-in person is known by their account; a website visitor by a random key their browser keeps
// (sent as X-Support-Key; only its SHA-256 is stored). Every new message is told live: to the customer's open chat
// (IJobEvents key "support:{id}") and to the console (AdminLiveFeed "support"), and pushed to whoever is not looking.

public sealed record SupportMessageDto(Guid Id, bool FromAdmin, string? AdminName, string Body, DateTime CreatedAtUtc);

public sealed record SupportThreadDto(Guid? ConversationId, bool Closed, IReadOnlyList<SupportMessageDto> Messages);

public sealed record AdminSupportRowDto(
    Guid Id, Guid? UserId, string Name, string? Email, string Source, string? LastMessage, bool LastFromAdmin,
    DateTime LastMessageAtUtc, bool Unread, bool Closed);

public sealed record AdminSupportThreadDto(
    Guid Id, Guid? UserId, string Name, string? Email, string Source, string? Path, bool IsPro, string? Country,
    DateTime CreatedAtUtc, bool Closed, IReadOnlyList<SupportMessageDto> Messages);

public static class SupportErrors
{
    public static readonly Error NoCaller = Error.Validation(
        "SUPPORT_NO_CALLER", "Open the chat again to start a conversation.");

    public static readonly Error Empty = Error.Validation("SUPPORT_EMPTY", "Write a message first.");

    public static readonly Error TooFast = Error.Validation(
        "SUPPORT_TOO_FAST", "That's a lot of messages at once. Give us a moment to read them.");

    public static readonly Error NotFound = Error.NotFound("SUPPORT_NOT_FOUND", "That conversation is gone.");
}

public static class SupportRules
{
    /// <summary>A customer's messages in <see cref="BurstWindow"/> before the next is refused (a script, not a person).</summary>
    public const int BurstLimit = 15;
    public static readonly TimeSpan BurstWindow = TimeSpan.FromMinutes(5);

    /// <summary>A thread shows its newest this many messages.</summary>
    public const int ThreadLength = 200;

    /// <summary>Admins are pushed at most this often for one thread's run of messages.</summary>
    public static readonly TimeSpan AdminPushQuiet = TimeSpan.FromMinutes(2);

    /// <summary>The key a visitor's browser makes: 32 random bytes as base64url, 43 characters; anything far off is not one.</summary>
    public const int MinKeyLength = 20, MaxKeyLength = 128;

    public static string EventKey(Guid conversationId) => $"support:{conversationId}";

    public static string? HashKey(string? key)
        => key is { Length: >= MinKeyLength and <= MaxKeyLength } ? AdminPhoneLockRules.Hash(key.Trim()) : null;

    internal static async Task<List<SupportMessageDto>> ThreadAsync(IApplicationDbContext db, Guid conversationId, CancellationToken ct)
    {
        var rows = await db.SupportMessages.AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.CreatedAtUtc).Take(ThreadLength)
            .Select(m => new
            {
                m.Id, m.AdminId, m.Body, m.CreatedAtUtc,
                Admin = db.Users.Where(u => u.Id == m.AdminId).Select(u => u.FullName).FirstOrDefault(),
            })
            .ToListAsync(ct);
        // Admins sign with their first name only.
        return rows.OrderBy(m => m.CreatedAtUtc)
            .Select(m => new SupportMessageDto(m.Id, m.AdminId != null, m.Admin?.Split(' ')[0], m.Body, m.CreatedAtUtc))
            .ToList();
    }
}

// ── The customer's side ──────────────────────────────────────────────────────────────────────────────────────────

/// <summary>The caller's thread (an account's, or the visitor key's), newest 200; marks it read. Empty when there is none.</summary>
public sealed record GetSupportThreadQuery(string? VisitorKey) : IRequest<Result<SupportThreadDto>>;

public sealed class GetSupportThreadQueryHandler : IRequestHandler<GetSupportThreadQuery, Result<SupportThreadDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IDateTimeProvider _clock;

    public GetSupportThreadQueryHandler(IApplicationDbContext db, ICurrentUser caller, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _clock = clock;
    }

    public async Task<Result<SupportThreadDto>> Handle(GetSupportThreadQuery request, CancellationToken ct)
    {
        var conversation = await SupportCaller.FindAsync(_db, _caller.UserId, request.VisitorKey, ct);
        if (conversation is null)
            return new SupportThreadDto(null, false, []);
        conversation.ReadByCustomer(_clock.UtcNow);
        await _db.SaveChangesAsync(ct);
        return new SupportThreadDto(conversation.Id, conversation.IsClosed, await SupportRules.ThreadAsync(_db, conversation.Id, ct));
    }
}

/// <summary>
/// A customer's message: starts their thread or adds to it (and opens it again if it was closed), tells the console
/// live, and pushes the admins unless they have been told about this thread in the last two minutes.
/// </summary>
public sealed record SendSupportMessageCommand(
    string? Body, string? VisitorKey, string Source, string? Path = null, string? Name = null, string? Email = null)
    : IRequest<Result<SupportMessageDto>>;

public sealed class SendSupportMessageCommandHandler : IRequestHandler<SendSupportMessageCommand, Result<SupportMessageDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IDateTimeProvider _clock;
    private readonly IJobEvents _events;
    private readonly IPushSender _push;
    private readonly IWebPushSender _webPush;

    public SendSupportMessageCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IDateTimeProvider clock, IJobEvents events, IPushSender push, IWebPushSender webPush)
    {
        _db = db;
        _caller = caller;
        _clock = clock;
        _events = events;
        _push = push;
        _webPush = webPush;
    }

    public async Task<Result<SupportMessageDto>> Handle(SendSupportMessageCommand request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        if (string.IsNullOrWhiteSpace(request.Body))
            return SupportErrors.Empty;

        var conversation = await SupportCaller.FindAsync(_db, _caller.UserId, request.VisitorKey, ct);
        if (conversation is null)
        {
            if (_caller.UserId is { } userId)
                conversation = SupportConversation.ForAccount(userId, now);
            else if (SupportRules.HashKey(request.VisitorKey) is { } hash)
                conversation = SupportConversation.ForVisitor(hash, now);
            else
                return SupportErrors.NoCaller;
            _db.SupportConversations.Add(conversation);
        }
        else
        {
            var since = now - SupportRules.BurstWindow;
            var recent = await _db.SupportMessages.CountAsync(
                m => m.ConversationId == conversation.Id && m.AdminId == null && m.CreatedAtUtc > since, ct);
            if (recent >= SupportRules.BurstLimit)
                return SupportErrors.TooFast;
        }

        var lastToldAt = conversation.LastCustomerMessageAtUtc;
        var adminHadRead = !conversation.UnreadByAdmin;
        var message = SupportMessage.Create(conversation.Id, null, request.Body, now)!;
        _db.SupportMessages.Add(message);
        conversation.CustomerWrote(request.Source, request.Path, request.Name, request.Email, now);
        await _db.SaveChangesAsync(ct);

        _events.Publish(SupportRules.EventKey(conversation.Id), new JobEvent(SupportEvents.Message));
        AdminLiveFeed.Tell(_events, SupportEvents.ConsoleFeed);

        // A run of messages is one push: a new thread, or one the admins had read, or a pause of two minutes.
        if (lastToldAt is null || adminHadRead || now - lastToldAt >= SupportRules.AdminPushQuiet)
            await TellAdminsAsync(conversation, message.Body, ct);

        return new SupportMessageDto(message.Id, false, null, message.Body, message.CreatedAtUtc);
    }

    private async Task TellAdminsAsync(SupportConversation conversation, string body, CancellationToken ct)
    {
        var who = conversation.UserId is { } userId
            ? await _db.Users.Where(u => u.Id == userId).Select(u => u.FullName).FirstOrDefaultAsync(ct)
            : conversation.Name;
        var title = $"Support · {(string.IsNullOrWhiteSpace(who) ? "A visitor" : who!.Trim())}";
        var line = body.Length <= 120 ? body : body[..117] + "…";

        await AdminConsolePush.SendToAdminsAsync(_db, _webPush,
            new WebPushNotification(title, line, $"nf-support-{conversation.Id}", $"/support?c={conversation.Id}", "support"), ct);

        var phones = await AdminAlertDevices.ReadAsync(AdminAlertDevices.Query(_db), _db, ct);
        if (phones.Count > 0)
            await _push.SendToDevicesAsync(phones.Select(p => p.Token).ToList(), new PushMessage(
                title, line,
                new Dictionary<string, string> { ["screen"] = "AdminSupport", ["conversationId"] = conversation.Id.ToString() },
                Sound: "default", ChannelId: "admin-activity", TimeToLiveSeconds: 3600), ct);
    }
}

public static class SupportEvents
{
    /// <summary>The customer's chat: a new message (theirs from another device, or an answer); it asks for the thread.</summary>
    public const string Message = "message";

    /// <summary>The console's live feed: a support thread changed.</summary>
    public const string ConsoleFeed = "support";
}

internal static class SupportCaller
{
    /// <summary>The caller's thread: the account's when signed in, else the visitor key's; null when there is none yet.</summary>
    public static async Task<SupportConversation?> FindAsync(IApplicationDbContext db, Guid? userId, string? visitorKey, CancellationToken ct)
    {
        if (userId is { } id)
            return await db.SupportConversations.FirstOrDefaultAsync(c => c.UserId == id, ct);
        return SupportRules.HashKey(visitorKey) is { } hash
            ? await db.SupportConversations.FirstOrDefaultAsync(c => c.VisitorKeyHash == hash, ct)
            : null;
    }
}

// ── The console's side ───────────────────────────────────────────────────────────────────────────────────────────

/// <summary>The support inbox: open threads first by their last message (unread first among them), then closed ones.</summary>
public sealed record GetSupportInboxQuery(bool IncludeClosed = true, int Take = 100) : IRequest<Result<IReadOnlyList<AdminSupportRowDto>>>;

public sealed class GetSupportInboxQueryHandler : IRequestHandler<GetSupportInboxQuery, Result<IReadOnlyList<AdminSupportRowDto>>>
{
    private readonly IApplicationDbContext _db;

    public GetSupportInboxQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<IReadOnlyList<AdminSupportRowDto>>> Handle(GetSupportInboxQuery request, CancellationToken ct)
    {
        var rows = await _db.SupportConversations.AsNoTracking()
            .Where(c => request.IncludeClosed || c.ClosedAtUtc == null)
            .OrderByDescending(c => c.LastMessageAtUtc)
            .Take(Math.Clamp(request.Take, 1, 500))
            .Select(c => new
            {
                c.Id, c.UserId, c.Name, c.Email, c.Source, c.LastMessageAtUtc, c.LastCustomerMessageAtUtc, c.AdminReadAtUtc, c.ClosedAtUtc,
                Account = _db.Users.Where(u => u.Id == c.UserId).Select(u => new { u.FullName, u.Email }).FirstOrDefault(),
                Last = _db.SupportMessages.Where(m => m.ConversationId == c.Id).OrderByDescending(m => m.CreatedAtUtc)
                    .Select(m => new { m.Body, m.AdminId }).FirstOrDefault(),
            })
            .ToListAsync(ct);

        return rows
            .Select(r => new AdminSupportRowDto(
                r.Id, r.UserId, r.Account?.FullName ?? r.Name ?? "Visitor", r.Account?.Email ?? r.Email, r.Source,
                r.Last?.Body, r.Last?.AdminId != null, r.LastMessageAtUtc,
                r.LastCustomerMessageAtUtc is { } at && (r.AdminReadAtUtc is null || r.AdminReadAtUtc < at),
                r.ClosedAtUtc != null))
            .OrderBy(r => r.Closed).ThenByDescending(r => r.Unread).ThenByDescending(r => r.LastMessageAtUtc)
            .ToList();
    }
}

/// <summary>Threads with something no admin has read: the console's nav badge.</summary>
public sealed record GetSupportUnreadQuery : IRequest<Result<int>>;

public sealed class GetSupportUnreadQueryHandler : IRequestHandler<GetSupportUnreadQuery, Result<int>>
{
    private readonly IApplicationDbContext _db;

    public GetSupportUnreadQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<int>> Handle(GetSupportUnreadQuery request, CancellationToken ct)
        => await _db.SupportConversations.CountAsync(
            c => c.LastCustomerMessageAtUtc != null && (c.AdminReadAtUtc == null || c.AdminReadAtUtc < c.LastCustomerMessageAtUtc), ct);
}

/// <summary>One thread for the console, with who it is; opening it marks it read.</summary>
public sealed record GetSupportConversationQuery(Guid Id) : IRequest<Result<AdminSupportThreadDto>>;

public sealed class GetSupportConversationQueryHandler : IRequestHandler<GetSupportConversationQuery, Result<AdminSupportThreadDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IJobEvents _events;

    public GetSupportConversationQueryHandler(IApplicationDbContext db, IDateTimeProvider clock, IJobEvents events)
    {
        _db = db;
        _clock = clock;
        _events = events;
    }

    public async Task<Result<AdminSupportThreadDto>> Handle(GetSupportConversationQuery request, CancellationToken ct)
    {
        var c = await _db.SupportConversations.FirstOrDefaultAsync(x => x.Id == request.Id, ct);
        if (c is null)
            return SupportErrors.NotFound;
        if (c.UnreadByAdmin)
        {
            c.ReadByAdmin(_clock.UtcNow);
            await _db.SaveChangesAsync(ct);
            AdminLiveFeed.Tell(_events, SupportEvents.ConsoleFeed);   // the other consoles' badges
        }

        var account = c.UserId is { } userId
            ? await _db.Users.Where(u => u.Id == userId).Select(u => new { u.FullName, u.Email, u.Country }).FirstOrDefaultAsync(ct)
            : null;
        var isPro = c.UserId is { } id && await Common.ProStatus.IsProAsync(_db, _clock, id, ct);
        return new AdminSupportThreadDto(
            c.Id, c.UserId, account?.FullName ?? c.Name ?? "Visitor", account?.Email ?? c.Email, c.Source, c.Path, isPro,
            account?.Country, c.CreatedAtUtc, c.IsClosed, await SupportRules.ThreadAsync(_db, c.Id, ct));
    }
}

/// <summary>An admin's answer: told live to the customer's open chat, and pushed to their phone and web app when it is not open.</summary>
public sealed record ReplySupportCommand(Guid Id, string? Body) : IRequest<Result<SupportMessageDto>>;

public sealed class ReplySupportCommandHandler : IRequestHandler<ReplySupportCommand, Result<SupportMessageDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IDateTimeProvider _clock;
    private readonly IJobEvents _events;
    private readonly IPushSender _push;
    private readonly IWebPushSender _webPush;

    public ReplySupportCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IDateTimeProvider clock, IJobEvents events, IPushSender push, IWebPushSender webPush)
    {
        _db = db;
        _caller = caller;
        _clock = clock;
        _events = events;
        _push = push;
        _webPush = webPush;
    }

    public async Task<Result<SupportMessageDto>> Handle(ReplySupportCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } adminId)
            return AdminErrors.NotAuthenticated;
        var conversation = await _db.SupportConversations.FirstOrDefaultAsync(c => c.Id == request.Id, ct);
        if (conversation is null)
            return SupportErrors.NotFound;
        var now = _clock.UtcNow;
        var message = SupportMessage.Create(conversation.Id, adminId, request.Body, now);
        if (message is null)
            return SupportErrors.Empty;

        _db.SupportMessages.Add(message);
        conversation.AdminWrote(now);
        conversation.Reopen();
        await _db.SaveChangesAsync(ct);

        var key = SupportRules.EventKey(conversation.Id);
        var looking = _events.IsWatched(key);
        _events.Publish(key, new JobEvent(SupportEvents.Message));
        AdminLiveFeed.Tell(_events, SupportEvents.ConsoleFeed);

        var adminName = await _db.Users.Where(u => u.Id == adminId).Select(u => u.FullName).FirstOrDefaultAsync(ct);
        var first = adminName?.Split(' ')[0];
        if (!looking && conversation.UserId is { } userId)
        {
            var title = string.IsNullOrWhiteSpace(first) ? "NoteFusion support" : $"{first} from NoteFusion";
            var line = message.Body.Length <= 140 ? message.Body : message.Body[..137] + "…";
            await _push.SendAsync([userId], new PushMessage(
                title, line, new Dictionary<string, string> { ["screen"] = "SupportChat" }, Sound: "default"), ct);
            await _webPush.SendAsync(userId, new WebPushNotification(title, line, "nf-support", "/app?support=1", "support"), ct);
        }
        return new SupportMessageDto(message.Id, true, first, message.Body, message.CreatedAtUtc);
    }
}

/// <summary>Closes or reopens a thread (the customer writing opens it again by itself).</summary>
public sealed record SetSupportClosedCommand(Guid Id, bool Closed) : IRequest<Result>;

public sealed class SetSupportClosedCommandHandler : IRequestHandler<SetSupportClosedCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IJobEvents _events;

    public SetSupportClosedCommandHandler(IApplicationDbContext db, IDateTimeProvider clock, IJobEvents events)
    {
        _db = db;
        _clock = clock;
        _events = events;
    }

    public async Task<Result> Handle(SetSupportClosedCommand request, CancellationToken ct)
    {
        var conversation = await _db.SupportConversations.FirstOrDefaultAsync(c => c.Id == request.Id, ct);
        if (conversation is null)
            return SupportErrors.NotFound;
        if (request.Closed)
            conversation.Close(_clock.UtcNow);
        else
            conversation.Reopen();
        await _db.SaveChangesAsync(ct);
        AdminLiveFeed.Tell(_events, SupportEvents.ConsoleFeed);
        return Result.Success();
    }
}

/// <summary>
/// How quickly customers are answered, for the chat's "We typically reply in …": the median wait, in minutes, from the
/// first customer message after an answer (or the thread's start) to the next answer, over the last
/// <see cref="WindowDays"/> days. Null until <see cref="MinimumAnswered"/> waits have been answered.
/// </summary>
public sealed record SupportInfoDto(int? TypicalReplyMinutes, int Answered);

public sealed record GetSupportInfoQuery : IRequest<Result<SupportInfoDto>>
{
    public const int WindowDays = 60;
    public const int MinimumAnswered = 5;
}

public sealed class GetSupportInfoQueryHandler : IRequestHandler<GetSupportInfoQuery, Result<SupportInfoDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetSupportInfoQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<SupportInfoDto>> Handle(GetSupportInfoQuery request, CancellationToken ct)
    {
        var since = _clock.UtcNow.AddDays(-GetSupportInfoQuery.WindowDays);
        var messages = await _db.SupportMessages.AsNoTracking()
            .Where(m => m.CreatedAtUtc >= since)
            .Select(m => new { m.ConversationId, FromAdmin = m.AdminId != null, m.CreatedAtUtc })
            .ToListAsync(ct);

        var waits = new List<double>();
        foreach (var thread in messages.GroupBy(m => m.ConversationId))
        {
            DateTime? waitingSince = null;
            foreach (var m in thread.OrderBy(m => m.CreatedAtUtc))
            {
                if (!m.FromAdmin)
                    waitingSince ??= m.CreatedAtUtc;
                else if (waitingSince is { } start)
                {
                    waits.Add((m.CreatedAtUtc - start).TotalMinutes);
                    waitingSince = null;
                }
            }
        }

        if (waits.Count < GetSupportInfoQuery.MinimumAnswered)
            return new SupportInfoDto(null, waits.Count);
        waits.Sort();
        var middle = waits.Count / 2;
        var median = waits.Count % 2 == 1 ? waits[middle] : (waits[middle - 1] + waits[middle]) / 2;
        return new SupportInfoDto((int)Math.Ceiling(median), waits.Count);
    }
}
