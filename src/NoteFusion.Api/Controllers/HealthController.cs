using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Controllers;

/// <summary>Liveness and readiness probes for compose, Heroku and any load balancer in front of them.</summary>
[ApiController]
[Route("health")]
public sealed class HealthController : ControllerBase
{
    private readonly IDatabaseHealth _database;
    private readonly ITranscriptionApi _transcriber;

    public HealthController(IDatabaseHealth database, ITranscriptionApi transcriber)
    {
        _database = database;
        _transcriber = transcriber;
    }

    /// <summary>
    /// Liveness: is this process answering HTTP at all?
    /// </summary>
    /// <remarks>
    /// Deliberately checks nothing. A liveness probe that fails on a dead dependency gets the process
    /// killed and restarted, which cannot fix a dependency and does destroy every in-flight request —
    /// and, with the compose healthcheck wired to this path, would stop the container coming up at all.
    /// Use <see cref="Ready"/> to decide whether to send traffic here.
    /// </remarks>
    [AllowAnonymous]
    [HttpGet]
    public IActionResult Get() => Ok(new { status = "ok" });

    /// <summary>
    /// Readiness: can this instance actually serve a request end to end? 200 when it can, 503 when it
    /// cannot. <c>degraded</c> still returns 200 — it serves today and breaks tomorrow.
    /// </summary>
    /// <remarks>
    /// Anonymous, because a probe cannot hold a token, so it reports statuses and latencies and never the
    /// underlying exception text: a provider error names hosts, users and sometimes credentials. The
    /// diagnosis lives on the admin health page, behind auth
    /// (<c>GetSystemHealthQuery</c>), which reads these same two probes.
    /// </remarks>
    /// <response code="200">Ready, or ready but degraded.</response>
    /// <response code="503">Not ready — do not route traffic to this instance.</response>
    [AllowAnonymous]
    [HttpGet("ready")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> Ready(CancellationToken ct)
    {
        var database = await CheckDatabase(ct);
        var worker = await CheckWorker(ct);

        var checks = new[] { database, worker };
        var status = checks.Any(c => c.Status == "down") ? "down"
            : checks.Any(c => c.Status == "degraded") ? "degraded"
            : "healthy";

        var body = new
        {
            status,
            checks = new { database, transcriber = worker }
        };

        // Only "down" withholds the instance. A pending migration is reported and routed to: refusing
        // traffic would take the site down to announce a schema drift that has not broken anything yet.
        return status == "down"
            ? StatusCode(StatusCodes.Status503ServiceUnavailable, body)
            : Ok(body);
    }

    private async Task<ReadinessCheck> CheckDatabase(CancellationToken ct)
    {
        var health = await _database.CheckAsync(ct);

        if (!health.IsReachable)
            return new ReadinessCheck("down", null, "unreachable");

        return health.PendingMigrations > 0
            ? new ReadinessCheck("degraded", health.LatencyMs, $"{health.PendingMigrations} pending migration(s)")
            : new ReadinessCheck("healthy", health.LatencyMs, null);
    }

    private async Task<ReadinessCheck> CheckWorker(CancellationToken ct)
    {
        // The worker is a hard dependency of the product, not of this process: with it down, every
        // endpoint but transcription still works, and a user mid-session keeps their library. It is
        // still reported as "down" — the deploy is not one anyone should be sending traffic to — and
        // PingAsync gives up after five seconds, so a hung worker cannot hang this probe.
        var ping = await _transcriber.PingAsync(ct);

        return ping.IsSuccess
            ? new ReadinessCheck("healthy", ping.Value, null)
            : new ReadinessCheck("down", null, "unreachable");
    }

    /// <param name="Status">One of <c>healthy</c>, <c>degraded</c>, <c>down</c>.</param>
    /// <param name="LatencyMs">Round trip to the dependency, when it answered.</param>
    /// <param name="Detail">Short, non-sensitive reason. Never a provider message.</param>
    private sealed record ReadinessCheck(string Status, int? LatencyMs, string? Detail);
}
