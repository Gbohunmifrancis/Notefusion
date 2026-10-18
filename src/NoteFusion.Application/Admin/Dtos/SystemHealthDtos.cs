using NoteFusion.Application.Common;

namespace NoteFusion.Application.Admin.Dtos;

/// <summary>
/// One tier's health, in the shape the dashboard renders a panel from.
/// </summary>
/// <remarks>
/// The status is computed here rather than left to the client, so "degraded" means the same thing on
/// every surface that shows it. <see cref="LatencyMs"/> is null when the tier is unreachable — a probe
/// that failed has no latency, and printing how long it took to fail as a response time makes an outage
/// look like a slow query.
/// </remarks>
/// <param name="Status">One of <c>healthy</c>, <c>degraded</c> or <c>down</c>.</param>
/// <param name="Detail">
/// The one line an operator needs: the error for a failed probe, or what is unusual for a degraded one.
/// Null when there is nothing to say, which the client renders as nothing rather than as "OK".
/// </param>
public sealed record HealthPanelDto(string Name, string Status, int? LatencyMs, string? Detail);

/// <summary>
/// Everything the health page can honestly report about this stack.
/// </summary>
/// <remarks>
/// Three panels and two stat blocks, and no more. There is no Redis, no message broker and no API
/// gateway in this architecture, so cache hit rates, queue depth and gateway throughput have no source —
/// a panel that reads "—" forever is worse than an absent one, because it looks like a broken metric
/// rather than a tier that does not exist. <see cref="NotMonitored"/> carries that explanation to the
/// page so the gaps are stated rather than left to be noticed.
/// <para>
/// Only the three panels can be "down": they are the three things with a probe behind them. The stat
/// blocks are context an operator reads alongside — a healthy-looking stack that transcribed nothing all
/// day is the shape of an outage no probe catches.
/// </para>
/// </remarks>
/// <param name="WebhookBacklog">
/// Provider webhooks received and not yet applied. The number that matters when a customer says they
/// paid and did not get Pro: a backlog with an old oldest-entry means the drain has stopped.
/// </param>
public sealed record WorkerHeartbeatDto(
    string WorkerName,
    DateTime LastRunUtc,
    long DurationMs,
    string Status,
    string? Detail);

public sealed record SystemHealthDto(
    string Status,
    DateTime CheckedAtUtc,
    HealthPanelDto Database,
    HealthPanelDto TranscriptionWorker,
    HealthPanelDto WebhookBacklog,
    ActivityStatsDto Activity,
    SubscriptionHealthDto Subscriptions,
    IReadOnlyList<string> NotMonitored,
    IReadOnlyList<WorkerHeartbeatDto>? WorkerHeartbeats = null,
    // The backups (ops/backup), as the backup service recorded them. Outside the rollup above: that answers
    // "is the product working", and a late backup does not stop it. Null when the database is unreachable.
    BackupStatusDto? Backups = null,
    // Mail sent in each capped window (last 24 h, 7 days, 31 days) against the email plan's limit, and the count
    // at which optional mail is held (EmailBudget). Null when the database is unreachable.
    IReadOnlyList<EmailWindowUsage>? EmailUsage = null,
    // Phones the API can reach and the admins' payment alerts (the phone admin's Push panel, board f-admin/06). Null
    // when the database is unreachable.
    PushHealthDto? Push = null);

/// <summary>
/// The Push panel: phones registered for push (customers' and the team's), the admin phones payment alerts go to, and
/// how the last payment alert went.
/// </summary>
/// <param name="LastPaymentAlertDevices">Admin phones the last alert was sent to; with <paramref name="LastPaymentAlertAccepted"/>, "reached 2 of 2".</param>
/// <param name="RefusedLast24h">Phones Expo refused payment alerts for over the last 24 hours (an expired token, say).</param>
public sealed record PushHealthDto(
    int PhonesRegistered,
    int Android,
    int Ios,
    int AdminAlertPhones,
    DateTime? LastPaymentAlertAtUtc,
    int LastPaymentAlertDevices,
    int LastPaymentAlertAccepted,
    int RefusedLast24h);

/// <summary>
/// Transcription throughput. Volume only, deliberately: the API records that a job was submitted and
/// which account owns it, and nothing else — the outcome lives in the Python worker's in-process queue
/// and is read live by the polling client, never persisted. So there is no failure rate to report here,
/// and a "0 failed" figure derived from the saved-transcription table would read as good news during a
/// total ML outage, because a job that fails never becomes a saved transcription in the first place.
/// </summary>
/// <param name="JobsLast24Hours">
/// Submissions, not successes. Read against a normal day: a stack whose probes are all green and whose
/// submissions went to zero is an outage the probes cannot see.
/// </param>
public sealed record ActivityStatsDto(int JobsLast24Hours, int JobsLast7Days);

/// <summary>
/// Live subscription counts. Not a health panel — nothing here can be "down" — but it is the other
/// question an operator opens this page to answer.
/// </summary>
/// <param name="ExpiringWithinSevenDays">
/// Excludes lifetime access, which never expires and would otherwise never appear in this count anyway;
/// stated so nobody later "fixes" the query by dropping the filter.
/// </param>
public sealed record SubscriptionHealthDto(
    int ActiveCount,
    int GiftedCount,
    int ExpiringWithinSevenDays,
    int PastDueCount);
