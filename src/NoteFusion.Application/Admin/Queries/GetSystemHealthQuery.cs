using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Admin.Services;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// The state of every tier this stack can actually prove something about.
/// </summary>
/// <remarks>
/// Never fails as a whole. Each probe is caught and degrades its own panel, because the page exists to be
/// read during an incident and one dead dependency taking the whole response down would hide the three
/// tiers that are still fine.
/// </remarks>
public sealed record GetSystemHealthQuery : IRequest<Result<SystemHealthDto>>;

public sealed class GetSystemHealthQueryHandler : IRequestHandler<GetSystemHealthQuery, Result<SystemHealthDto>>
{
    /// <summary>
    /// How old the oldest unapplied webhook may be before the panel calls it degraded. Generous, because
    /// the drain is a polling worker rather than an instant one — but a payment that has sat unapplied for
    /// five minutes is a customer already writing in.
    /// </summary>
    private static readonly TimeSpan WebhookBacklogTolerance = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Tiers a production checklist asks about that this architecture genuinely does not have, or does not
    /// retain the data for. Sent to the client so the page can say so, rather than leaving the absences to
    /// be read as an oversight.
    /// </summary>
    private static readonly string[] NotMonitored =
    [
        "In-memory cache — there is no Redis or memcached tier; nothing is cached outside a request.",
        "Message broker — the Python worker owns an in-process job queue, so there is no broker to inspect.",
        "API gateway — clients reach this API directly; there is no gateway in front of it.",
        "Transcription failure rate — job outcomes are never persisted by this API, only polled live from "
        + "the worker, so the only honest transcription figure is submitted volume.",
    ];

    private readonly IApplicationDbContext _db;
    private readonly IDatabaseHealth _database;
    private readonly ITranscriptionApi _transcriber;
    private readonly IDateTimeProvider _clock;
    private readonly IWorkerHeartbeatTracker? _heartbeats;
    private readonly IEmailQuota? _emailQuota;

    public GetSystemHealthQueryHandler(
        IApplicationDbContext db,
        IDatabaseHealth database,
        ITranscriptionApi transcriber,
        IDateTimeProvider clock,
        IWorkerHeartbeatTracker? heartbeats = null,
        IEmailQuota? emailQuota = null)
    {
        _db = db;
        _database = database;
        _transcriber = transcriber;
        _clock = clock;
        _heartbeats = heartbeats;
        _emailQuota = emailQuota;
    }

    public async Task<Result<SystemHealthDto>> Handle(GetSystemHealthQuery request, CancellationToken ct)
    {
        var now = _clock.UtcNow;

        var database = await CheckDatabase(ct);
        var worker = await CheckWorker(ct);

        // Everything below reads the database, so it can only be asked once the database answered. Skipped
        // rather than attempted when it did not: a page full of panels erroring on the same dead connection
        // says less than one panel naming it.
        var backlog = database.Status == "down"
            ? Unavailable("Webhook backlog")
            : await CheckWebhookBacklog(now, ct);

        var activity = database.Status == "down"
            ? new ActivityStatsDto(0, 0)
            : await CountActivity(now, ct);

        var subscriptions = database.Status == "down"
            ? new SubscriptionHealthDto(0, 0, 0, 0)
            : await CountSubscriptions(now, ct);

        var backups = database.Status == "down"
            ? null
            : (await BackupHealth.ReadAsync(_db, now, ct)).Status;

        var emailUsage = database.Status == "down" || _emailQuota is null
            ? null
            : await _emailQuota.ReadUsageAsync(ct);

        var panels = new[] { database, worker, backlog };
        var status = panels.Any(p => p.Status == "down") ? "down"
            : panels.Any(p => p.Status == "degraded") ? "degraded"
            : "healthy";

        var heartbeatDtos = _heartbeats?.GetAll()
            .Select(h => new WorkerHeartbeatDto(h.WorkerName, h.LastRunUtc, h.DurationMs, h.Status, h.Detail))
            .ToList() ?? (IReadOnlyList<WorkerHeartbeatDto>)Array.Empty<WorkerHeartbeatDto>();

        return new SystemHealthDto(
            status, now, database, worker, backlog, activity, subscriptions, NotMonitored, heartbeatDtos, backups, emailUsage);
    }

    private async Task<HealthPanelDto> CheckDatabase(CancellationToken ct)
    {
        var health = await _database.CheckAsync(ct);

        if (!health.IsReachable)
            return new HealthPanelDto("Database", "down", null, health.Error);

        // A pending migration is not an outage — the database is answering — but it is the difference
        // between "working" and "about to throw on the first request that touches the new column".
        return health.PendingMigrations > 0
            ? new HealthPanelDto("Database", "degraded", health.LatencyMs,
                $"{health.PendingMigrations} migration(s) not applied to this database.")
            : new HealthPanelDto("Database", "healthy", health.LatencyMs, null);
    }

    private async Task<HealthPanelDto> CheckWorker(CancellationToken ct)
    {
        var ping = await _transcriber.PingAsync(ct);

        return ping.IsSuccess
            ? new HealthPanelDto("Transcription worker", "healthy", ping.Value, null)
            : new HealthPanelDto("Transcription worker", "down", null, ping.Error.Message);
    }

    private async Task<HealthPanelDto> CheckWebhookBacklog(DateTime now, CancellationToken ct)
    {
        var unprocessed = _db.WebhookEvents.Where(w => w.Status == WebhookStatus.Received);

        var count = await unprocessed.CountAsync(ct);
        if (count == 0)
        {
            // Failed rows are still worth naming: they are parked for reconciliation, so nobody is coming
            // back for them unless someone reads this.
            var failed = await _db.WebhookEvents.CountAsync(w => w.Status == WebhookStatus.Failed, ct);
            return failed > 0
                ? new HealthPanelDto("Webhook backlog", "degraded", null,
                    $"Nothing waiting, but {failed} event(s) are parked as failed.")
                : new HealthPanelDto("Webhook backlog", "healthy", null, null);
        }

        var oldest = await unprocessed.MinAsync(w => w.ReceivedAtUtc, ct);
        var age = now - oldest;

        return age > WebhookBacklogTolerance
            ? new HealthPanelDto("Webhook backlog", "degraded", null,
                $"{count} waiting; the oldest has been unapplied for {Describe(age)}.")
            : new HealthPanelDto("Webhook backlog", "healthy", null, $"{count} waiting, all recent.");
    }

    private async Task<ActivityStatsDto> CountActivity(DateTime now, CancellationToken ct)
        // Jobs, not saved transcriptions: a job row is written for every submission, Pro or free, and it is
        // the only record this API keeps of work being asked for. Saved transcriptions would undercount,
        // because a user who transcribes and does not save leaves no library row behind.
        => new(
            JobsLast24Hours: await _db.TranscriptionJobs.CountAsync(j => j.CreatedAtUtc >= now.AddHours(-24), ct),
            JobsLast7Days: await _db.TranscriptionJobs.CountAsync(j => j.CreatedAtUtc >= now.AddDays(-7), ct));

    private async Task<SubscriptionHealthDto> CountSubscriptions(DateTime now, CancellationToken ct)
    {
        // Active in the sense the app uses — the status and the period window together — rather than
        // Status == Active alone, which would count a cancelled-but-still-paid customer as gone and an
        // expired-but-never-swept row as present.
        // Customers only: a gift to the team is not a subscriber (AnalyticsScope).
        var live = _db.RealSubscriptions().Where(s =>
            (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled)
            && s.CurrentPeriodEndUtc > now);

        var sevenDays = now.AddDays(7);

        return new SubscriptionHealthDto(
            ActiveCount: await live.CountAsync(ct),
            GiftedCount: await live.CountAsync(s => s.Provider == null, ct),
            // Lifetime excluded by the upper bound itself — the sentinel is centuries away — so no extra
            // filter is needed, and one would only invite a "simplification" that breaks it.
            ExpiringWithinSevenDays: await live.CountAsync(s => s.CurrentPeriodEndUtc <= sevenDays, ct),
            PastDueCount: await _db.RealSubscriptions().CountAsync(s => s.Status == SubscriptionStatus.PastDue, ct));
    }

    private static HealthPanelDto Unavailable(string name)
        => new(name, "down", null, "Not checked — the database is unreachable.");

    private static string Describe(TimeSpan age)
        => age.TotalHours >= 1
            ? $"{(int)age.TotalHours}h {age.Minutes}m"
            : $"{(int)age.TotalMinutes}m";
}
