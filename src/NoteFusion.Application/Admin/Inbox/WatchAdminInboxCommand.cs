using MediatR;
using NoteFusion.Application.Admin.ConsoleAlerts;
using NoteFusion.Application.Analytics;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Application.Admin.Inbox;

/// <summary>
/// Looks at the newest inbound emails (Resend, <see cref="IResendInboxService"/>) and tells the admins' consoles of each
/// one that arrived since <paramref name="SeenUpTo"/>: a web push (audience "console") and a live notice ("inbox") the
/// open Mail page refetches on. Null <paramref name="SeenUpTo"/> is the first look after the API starts: it only notes
/// where the inbox stands, so a restart never pushes old mail. Mail that arrives while the API is down is not pushed.
/// </summary>
public sealed record WatchAdminInboxCommand(DateTime? SeenUpTo, IReadOnlySet<Guid> SeenIds) : IRequest<WatchAdminInboxRun>;

/// <summary>Where the inbox now stands (the newest received time seen) and the emails told of this time.</summary>
public sealed record WatchAdminInboxRun(DateTime? SeenUpTo, IReadOnlyList<Guid> Told);

public sealed class WatchAdminInboxCommandHandler : IRequestHandler<WatchAdminInboxCommand, WatchAdminInboxRun>
{
    /// <summary>The newest emails read each look: more than a minute's mail.</summary>
    public const int Newest = 20;

    /// <summary>Up to this many new emails get a notification each; more are one summary.</summary>
    public const int EachUpTo = 3;

    private readonly IResendInboxService _inbox;
    private readonly IApplicationDbContext _db;
    private readonly IWebPushSender _webPush;
    private readonly IJobEvents _events;

    public WatchAdminInboxCommandHandler(IResendInboxService inbox, IApplicationDbContext db, IWebPushSender webPush, IJobEvents events)
    {
        _inbox = inbox;
        _db = db;
        _webPush = webPush;
        _events = events;
    }

    public async Task<WatchAdminInboxRun> Handle(WatchAdminInboxCommand request, CancellationToken ct)
    {
        var page = await _inbox.ListAsync(1, Newest, ct);
        var newest = page.Items.Count > 0 ? page.Items.Max(e => e.ReceivedAt) : (DateTime?)null;
        if (request.SeenUpTo is not { } seenUpTo)
            return new WatchAdminInboxRun(newest ?? DateTime.MinValue, []);

        var fresh = page.Items
            .Where(e => e.ReceivedAt > seenUpTo && !request.SeenIds.Contains(e.Id))
            .OrderBy(e => e.ReceivedAt)
            .ToList();
        if (fresh.Count == 0)
            return new WatchAdminInboxRun(Max(seenUpTo, newest), []);

        AdminLiveFeed.Tell(_events, AdminInboxFeed.Event);
        if (fresh.Count <= EachUpTo)
            foreach (var email in fresh)
                await AdminConsolePush.SendToAdminsAsync(_db, _webPush, AdminInboxCopy.One(email), ct);
        else
            await AdminConsolePush.SendToAdminsAsync(_db, _webPush, AdminInboxCopy.Several(fresh), ct);
        return new WatchAdminInboxRun(Max(seenUpTo, newest), [.. fresh.Select(e => e.Id)]);
    }

    private static DateTime Max(DateTime a, DateTime? b) => b is { } x && x > a ? x : a;
}

/// <summary>The console's live notice for new mail: the Mail page refetches on it.</summary>
public static class AdminInboxFeed
{
    public const string Event = "inbox";
}

/// <summary>The words of a new-mail notification: who wrote and the subject, opening the email in Mail.</summary>
public static class AdminInboxCopy
{
    public static WebPushNotification One(ResendInboxEmailSummary email)
        => new($"Email · {Sender(email.From)}", Clip(email.Subject, 120), $"nf-mail-{email.Id}", "/inbox", "email");

    public static WebPushNotification Several(IReadOnlyList<ResendInboxEmailSummary> emails)
        => new($"{emails.Count} new emails",
            Clip(string.Join(" · ", emails.OrderByDescending(e => e.ReceivedAt).Take(3).Select(e => $"{Sender(e.From)}: {e.Subject}")), 120),
            "nf-mail", "/inbox", "email");

    /// <summary>"Ada Obi &lt;ada@example.com&gt;" is Ada Obi; a bare address is itself.</summary>
    public static string Sender(string from)
    {
        var lt = from.IndexOf('<');
        var name = (lt > 0 ? from[..lt] : from).Trim().Trim('"').Trim();
        return name.Length > 0 ? name : from.Trim();
    }

    private static string Clip(string text, int max) => text.Length <= max ? text : text[..(max - 1)] + "…";
}
