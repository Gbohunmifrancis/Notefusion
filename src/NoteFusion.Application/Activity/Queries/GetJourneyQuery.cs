using System.Globalization;
using MediatR;
using NoteFusion.Application.Activity;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Activity.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Activity.Queries;

/// <summary>
/// Everything one subject did over the last <paramref name="Days"/> days, newest first. The subject is an
/// account (<paramref name="UserId"/>), a device (<paramref name="Device"/>, the hash on previews and web
/// events) or a browser (<paramref name="Visitor"/>, the tracker's random id); exactly one is expected.
/// </summary>
/// <remarks>
/// A person reaches the site as an anonymous browser and only later signs in, so the account's journey
/// also pulls in every browser and device that has ever been seen signed in as it: the pages they looked
/// at and the previews they ran before the account existed belong on the same timeline.
/// </remarks>
public sealed record GetJourneyQuery(Guid? UserId = null, string? Device = null, string? Visitor = null, int Days = 30)
    : IRequest<Result<JourneyDto>>
{
    public const int MaxDays = TranscriptionLog.RetentionDays;
    public const int MaxWebEvents = 1500;
    public const int MaxLogs = 500;
    public const int MaxPayments = 200;
    public const int MaxAppEvents = 1500;
    public const int MaxActivities = 500;
    private const int MaxIdentities = 25;

    internal static int IdentityCap => MaxIdentities;
}

public sealed class GetJourneyQueryHandler : IRequestHandler<GetJourneyQuery, Result<JourneyDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetJourneyQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<JourneyDto>> Handle(GetJourneyQuery request, CancellationToken ct)
    {
        var to = _clock.UtcNow;
        var from = to.AddDays(-Math.Clamp(request.Days, 1, GetJourneyQuery.MaxDays));
        var cap = GetJourneyQuery.IdentityCap;

        Guid? userId = request.UserId;
        List<string> visitors;
        List<string> devices;
        List<Guid> accounts;

        if (userId is { } uid)
        {
            if (!await _db.Users.AnyAsync(u => u.Id == uid, ct))
                return UserErrors.NotFound;

            visitors = await _db.WebEvents.Where(e => e.UserId == uid)
                .Select(e => e.VisitorId).Distinct().Take(cap).ToListAsync(ct);
            devices = (await _db.WebEvents.Where(e => e.UserId == uid && e.DeviceHash != null).Select(e => e.DeviceHash!).Distinct().Take(cap).ToListAsync(ct))
                .Concat(await _db.TranscriptionJobs.Where(j => j.UserId == uid && j.DeviceFingerprint != null).Select(j => j.DeviceFingerprint!).Distinct().Take(cap).ToListAsync(ct))
                .Concat(await _db.TranscriptionLogs.Where(l => l.UserId == uid && l.DeviceHash != null).Select(l => l.DeviceHash!).Distinct().Take(cap).ToListAsync(ct))
                .Distinct().Take(cap).ToList();
            accounts = [uid];
        }
        else if (!string.IsNullOrWhiteSpace(request.Device))
        {
            var device = request.Device.Trim();
            devices = [device];
            visitors = await _db.WebEvents.Where(e => e.DeviceHash == device)
                .Select(e => e.VisitorId).Distinct().Take(cap).ToListAsync(ct);
            accounts = await AccountsSeenAsync(visitors, devices, ct);
        }
        else if (!string.IsNullOrWhiteSpace(request.Visitor))
        {
            var visitor = request.Visitor.Trim();
            visitors = [visitor];
            devices = await _db.WebEvents.Where(e => e.VisitorId == visitor && e.DeviceHash != null)
                .Select(e => e.DeviceHash!).Distinct().Take(cap).ToListAsync(ct);
            accounts = await AccountsSeenAsync(visitors, devices, ct);
        }
        else
        {
            return Error.Validation("Activity.NoSubject", "Pick an account, a device or a visitor.");
        }

        // An anonymous subject that turns out to have signed in is shown with that account's payments.
        var paymentAccounts = userId is { } only ? [only] : accounts;

        var events = await _db.WebEvents.AsNoTracking()
            .Where(e => e.OccurredAtUtc >= from && e.OccurredAtUtc < to
                && ((userId != null && e.UserId == userId)
                    || visitors.Contains(e.VisitorId)
                    || (e.DeviceHash != null && devices.Contains(e.DeviceHash))))
            .OrderByDescending(e => e.OccurredAtUtc)
            .Take(GetJourneyQuery.MaxWebEvents + 1)
            .ToListAsync(ct);

        var logs = await _db.TranscriptionLogs.AsNoTracking()
            .Where(l => l.CreatedAtUtc >= from && l.CreatedAtUtc < to
                && ((userId != null && l.UserId == userId)
                    || (l.DeviceHash != null && devices.Contains(l.DeviceHash))))
            .OrderByDescending(l => l.CreatedAtUtc)
            .Take(GetJourneyQuery.MaxLogs + 1)
            .ToListAsync(ct);
        var savedJobs = await SavedJobIdsAsync(logs, ct);

        var payments = await _db.PaymentTransactions.AsNoTracking()
            .Where(p => p.CreatedAtUtc >= from && p.CreatedAtUtc < to && paymentAccounts.Contains(p.UserId))
            .OrderByDescending(p => p.CreatedAtUtc)
            .Take(GetJourneyQuery.MaxPayments + 1)
            .ToListAsync(ct);

        // The phone's own events and what the server saw the account do: an account's, so only for an account's journey.
        var appEvents = userId is { } appUser
            ? await _db.AppEvents.AsNoTracking()
                .Where(e => e.UserId == appUser && e.OccurredAtUtc >= from && e.OccurredAtUtc < to)
                .OrderByDescending(e => e.OccurredAtUtc)
                .Take(GetJourneyQuery.MaxAppEvents + 1)
                .ToListAsync(ct)
            : [];
        var activities = userId is { } activityUser
            ? await _db.UserActivities.AsNoTracking()
                .Where(a => a.UserId == activityUser && a.OccurredAtUtc >= from && a.OccurredAtUtc < to)
                .OrderByDescending(a => a.OccurredAtUtc)
                .Take(GetJourneyQuery.MaxActivities + 1)
                .ToListAsync(ct)
            : [];

        var user = userId is { } id
            ? await _db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => new { u.FullName, u.Email, u.CreatedAt }).FirstOrDefaultAsync(ct)
            : null;

        var truncated = events.Count > GetJourneyQuery.MaxWebEvents
            || logs.Count > GetJourneyQuery.MaxLogs
            || payments.Count > GetJourneyQuery.MaxPayments
            || appEvents.Count > GetJourneyQuery.MaxAppEvents
            || activities.Count > GetJourneyQuery.MaxActivities;

        var items = new List<JourneyItemDto>();
        items.AddRange(events.Take(GetJourneyQuery.MaxWebEvents).Select(FromWebEvent));
        items.AddRange(logs.Take(GetJourneyQuery.MaxLogs).Select(l => FromLog(l, l.JobId is not null && savedJobs.Contains(l.JobId))));
        items.AddRange(payments.Take(GetJourneyQuery.MaxPayments).Select(FromPayment));
        items.AddRange(appEvents.Take(GetJourneyQuery.MaxAppEvents).Select(e => new JourneyItemDto(
            e.OccurredAtUtc, "app", ActivityNames.TitleOrName(e.Name), ActivityNames.DetailLine(e.Detail, null),
            null, null, "phone", ToneOf(e.Name.Replace('_', ' ')), null)));
        items.AddRange(activities.Take(GetJourneyQuery.MaxActivities).Select(a => new JourneyItemDto(
            a.OccurredAtUtc, a.Name == UserActivity.SignIn ? "login" : "activity", ActivityNames.TitleOrName(a.Name),
            ActivityNames.DetailLine(a.Detail, null), null, null, a.Client, a.Name == UserActivity.AccountDeleted ? "warn" : "ok", null)));
        if (user is not null && user.CreatedAt >= from && user.CreatedAt < to)
            items.Add(new JourneyItemDto(user.CreatedAt, "signup", "Created the account", user.Email, null, null, null, "ok", null));

        return new JourneyDto(
            userId, user?.FullName, user?.Email, from, to,
            visitors, devices, userId is null ? accounts : [],
            Sessions: events.Select(e => e.SessionId).Distinct().Count(),
            Pageviews: events.Count(e => e.Kind == WebEvent.Pageview),
            Transcriptions: Math.Min(logs.Count, GetJourneyQuery.MaxLogs),
            Payments: Math.Min(payments.Count, GetJourneyQuery.MaxPayments),
            Truncated: truncated,
            Items: [.. items.OrderByDescending(i => i.AtUtc)]);
    }

    /// <summary>Accounts that were signed in on any of these browsers or devices.</summary>
    private async Task<List<Guid>> AccountsSeenAsync(List<string> visitors, List<string> devices, CancellationToken ct)
    {
        var fromEvents = await _db.WebEvents
            .Where(e => e.UserId != null && (visitors.Contains(e.VisitorId) || (e.DeviceHash != null && devices.Contains(e.DeviceHash))))
            .Select(e => e.UserId!.Value).Distinct().Take(GetJourneyQuery.IdentityCap).ToListAsync(ct);
        var fromLogs = await _db.TranscriptionLogs
            .Where(l => l.UserId != null && l.DeviceHash != null && devices.Contains(l.DeviceHash))
            .Select(l => l.UserId!.Value).Distinct().Take(GetJourneyQuery.IdentityCap).ToListAsync(ct);
        var fromClaims = await _db.PreviewJobs
            .Where(p => p.ClaimedByUserId != null && p.DeviceFingerprint != null && devices.Contains(p.DeviceFingerprint))
            .Select(p => p.ClaimedByUserId!.Value).Distinct().Take(GetJourneyQuery.IdentityCap).ToListAsync(ct);
        return [.. fromEvents.Concat(fromLogs).Concat(fromClaims).Distinct().Take(GetJourneyQuery.IdentityCap)];
    }

    private async Task<HashSet<string>> SavedJobIdsAsync(List<TranscriptionLog> logs, CancellationToken ct)
    {
        var jobIds = logs.Where(l => l.JobId != null).Select(l => l.JobId!).ToList();
        if (jobIds.Count == 0)
            return [];
        var saved = await _db.Transcriptions
            .Where(t => t.SourceJobId != null && jobIds.Contains(t.SourceJobId))
            .Select(t => t.SourceJobId!)
            .ToListAsync(ct);
        return [.. saved];
    }

    private static JourneyItemDto FromWebEvent(WebEvent e) => e.Kind switch
    {
        WebEvent.Pageview => new JourneyItemDto(
            e.OccurredAtUtc, "pageview", $"Viewed {e.Path}",
            e.Referrer is null ? null : $"Came from {e.Referrer}", e.Path, e.SessionId, e.Device, "ok", null),
        WebEvent.Click => new JourneyItemDto(
            e.OccurredAtUtc, "click", $"Clicked “{e.Name}”", e.Target, e.Path, e.SessionId, e.Device, "ok", null),
        _ => new JourneyItemDto(
            e.OccurredAtUtc, "action", e.Name ?? "Action", e.Detail, e.Path, e.SessionId, e.Device, ToneOf(e.Name), null)
    };

    /// <summary>Actions named as failures are shown as errors, hesitations as warnings, by the names the tracker uses.</summary>
    internal static string ToneOf(string? name)
    {
        var n = (name ?? string.Empty).ToLowerInvariant();
        if (n.Contains("fail") || n.Contains("error"))
            return "error";
        if (n.Contains("not confirmed") || n.Contains("abandon") || n.Contains("cancel"))
            return "warn";
        return "ok";
    }

    private static JourneyItemDto FromLog(TranscriptionLog l, bool saved)
    {
        var what = l.Kind switch
        {
            "link" => $"Pasted a song link: {l.SongTitle ?? l.LinkUrl ?? "unknown"}",
            "score" => $"Uploaded a score: {l.FileName ?? "unnamed"}",
            "song" => $"Uploaded a song: {l.FileName ?? "unnamed"}",
            _ => $"Uploaded {l.FileName ?? "a recording"}"
        };
        if (l.Origin == TranscriptionLog.PreviewOrigin)
            what = "Free preview · " + what;

        var parts = new List<string>();
        if (l.SizeBytes is { } size) parts.Add(FormatBytes(size));
        if (l.AudioSeconds is { } secs) parts.Add($"{secs.ToString("0.#", CultureInfo.InvariantCulture)} s");
        parts.Add(l.Mode);
        parts.Add(l.Status switch
        {
            TranscriptionLog.Done => l.DetectedKey is null ? "done" : $"done: {l.DetectedKey}, {l.DetectedTempo} BPM, {l.NoteCount} notes",
            TranscriptionLog.Failed => $"failed: {l.FailureReason}",
            TranscriptionLog.Refused => $"refused: {l.FailureReason}",
            _ => "in progress"
        });
        if (l.UsedStorePreview) parts.Add("store preview only");
        parts.Add(saved ? "saved" : "not saved");

        var tone = l.Status switch
        {
            TranscriptionLog.Failed or TranscriptionLog.Refused => "error",
            _ when l.UsedStorePreview => "warn",
            _ => "ok"
        };
        return new JourneyItemDto(l.CreatedAtUtc, "transcription", what, string.Join(" · ", parts), null, null, l.Client, tone, l.Id.ToString());
    }

    private static JourneyItemDto FromPayment(Core.Entities.Billing.PaymentTransaction p)
    {
        var amount = (p.AmountMinor / 100m).ToString("#,0.00", CultureInfo.InvariantCulture);
        var tone = p.Status switch
        {
            PaymentStatus.Failed => "error",
            PaymentStatus.Pending or PaymentStatus.Processing => "warn",
            _ => "ok"
        };
        return new JourneyItemDto(
            p.CreatedAtUtc, "payment", $"Payment {p.Status.ToString().ToLowerInvariant()}: {p.Currency} {amount} via {p.Provider}",
            p.FailureReason, null, null, null, tone, p.Reference);
    }

    internal static string FormatBytes(long bytes) => bytes switch
    {
        >= 1024 * 1024 => $"{(bytes / 1024d / 1024d).ToString("0.0", CultureInfo.InvariantCulture)} MB",
        >= 1024 => $"{(bytes / 1024d).ToString("0", CultureInfo.InvariantCulture)} KB",
        _ => $"{bytes} B"
    };
}
