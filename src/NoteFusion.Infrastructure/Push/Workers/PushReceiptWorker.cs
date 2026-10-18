using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Push.Workers;

/// <summary>What one receipt run did.</summary>
internal sealed record PushReceiptRun(int Read, int Refused, int Dropped, string? Problem);

/// <summary>
/// Reads the receipts of the pushes Expo took (<see cref="PushTicketLog"/>): what Google or Apple did with each. A
/// refusal used to be lost without a word, so a missing FCM key on Expo silenced every Android push while the API
/// counted them sent. Now a key problem is an error (Sentry, at most hourly per code), every refusal shows on System
/// Health, and a phone that no longer takes pushes has its token dropped.
/// </summary>
internal sealed class PushReceiptWorker : BackgroundService
{
    internal static readonly TimeSpan Interval = TimeSpan.FromMinutes(2);

    /// <summary>A receipt is asked for once its ticket is this old: Google has usually answered by then.</summary>
    internal static readonly TimeSpan MinAge = TimeSpan.FromMinutes(1);

    /// <summary>A problem that stops every push is logged as an error once per this long, not on every run.</summary>
    internal static readonly TimeSpan LogEvery = TimeSpan.FromHours(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly PushTicketLog _tickets;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<PushReceiptWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeats;
    private readonly Dictionary<string, DateTime> _loggedAt = new(StringComparer.Ordinal);

    public PushReceiptWorker(
        IServiceScopeFactory scopeFactory,
        PushTicketLog tickets,
        IDateTimeProvider clock,
        ILogger<PushReceiptWorker> logger,
        IWorkerHeartbeatTracker? heartbeats = null)
    {
        _scopeFactory = scopeFactory;
        _tickets = tickets;
        _clock = clock;
        _logger = logger;
        _heartbeats = heartbeats;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                var run = await RunOnceAsync(stoppingToken);
                sw.Stop();
                _heartbeats?.RecordHeartbeat(
                    "PushReceipts",
                    sw.ElapsedMilliseconds,
                    run.Problem is not null ? "Degraded" : "Healthy",
                    run.Read == 0 && run.Dropped == 0
                        ? "Nothing to read"
                        : $"{run.Read} receipt(s), {run.Refused} refused, {run.Dropped} dead phone(s) dropped"
                          + (run.Problem is null ? "" : $" · {run.Problem}"));
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                sw.Stop();
                _heartbeats?.RecordHeartbeat("PushReceipts", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Push receipt run failed.");
            }
        }
    }

    internal async Task<PushReceiptRun> RunOnceAsync(CancellationToken ct)
    {
        _tickets.Expire();

        using var scope = _scopeFactory.CreateScope();
        int read = 0, refused = 0;
        var codes = new Dictionary<string, int>(StringComparer.Ordinal);
        if (scope.ServiceProvider.GetRequiredService<IPushReceipts>() is ExpoPushReceipts receipts)
        {
            while (true)
            {
                var due = _tickets.Due(MinAge, ExpoPushReceipts.MaxPerRequest);
                if (due.Count == 0)
                    break;

                // Null: Expo unreachable, and the next run asks again. A ticket Google has not answered is left out.
                var answers = await receipts.ReadAsync(due, ct);
                if (answers is null)
                    break;

                foreach (var (id, receipt) in answers)
                {
                    if (!_tickets.Settle(id, receipt))
                        continue;
                    read++;
                    if (receipt.ErrorCode is not { } code)
                        continue;
                    refused++;
                    codes[code] = codes.GetValueOrDefault(code) + 1;
                }

                if (answers.Count < due.Count)
                    break; // the rest are not answered yet
            }
        }

        // Dead phones, from these receipts and from tickets refused at the send.
        var dead = _tickets.TakeDead();
        var dropped = dead.Count == 0
            ? 0
            : await scope.ServiceProvider.GetRequiredService<IDeviceTokenService>().ForgetAsync(dead, ct);

        string? problem = null;
        var now = _clock.UtcNow;
        foreach (var (code, count) in codes.OrderByDescending(c => c.Value))
        {
            if (PushProblems.StopsEveryPush(code))
            {
                problem ??= code;
                if (_loggedAt.TryGetValue(code, out var at) && now - at < LogEvery)
                    continue;
                _loggedAt[code] = now;
                _logger.LogError(
                    "{Count} push(es) refused with {Code}: {Problem}", count, code, PushProblems.Describe(code));
            }
            else
            {
                _logger.LogWarning("{Count} push(es) refused with {Code}.", count, code);
            }
        }

        return new PushReceiptRun(read, refused, dropped, problem);
    }
}
