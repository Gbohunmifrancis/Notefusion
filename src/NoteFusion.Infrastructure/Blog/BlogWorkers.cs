using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Blog.Drafting;
using NoteFusion.Application.Blog.Publishing;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Blog;

/// <summary>
/// Every <see cref="Interval"/>: scheduled posts whose time has come go live, and pending rebuild requests
/// become one dispatch of the website's deploy workflow (<see cref="BlogSitePublisher"/>). Kept apart from the
/// draft worker so a long batch of drafts never holds up a publish.
/// </summary>
internal sealed class BlogSiteWorker : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<BlogSiteWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeat;

    public BlogSiteWorker(IServiceScopeFactory scopes, ILogger<BlogSiteWorker> logger, IWorkerHeartbeatTracker? heartbeat = null)
    {
        _scopes = scopes;
        _logger = logger;
        _heartbeat = heartbeat;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using var scope = _scopes.CreateScope();
                var publisher = scope.ServiceProvider.GetRequiredService<BlogSitePublisher>();
                var published = await publisher.PublishDueAsync(stoppingToken);
                var dispatched = await publisher.DispatchRebuildIfDueAsync(stoppingToken);
                _heartbeat?.RecordHeartbeat("BlogSite", sw.ElapsedMilliseconds, "Healthy",
                    $"{published} scheduled post(s) published; rebuild {(dispatched ? "dispatched" : "not needed")}");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _heartbeat?.RecordHeartbeat("BlogSite", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Blog site sweep failed.");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }
}

/// <summary>
/// Writes the queued batches of drafts one at a time and queues the twice-weekly batch
/// (<see cref="BlogGenerationRunner"/>). At start it closes a batch a restart interrupted.
/// </summary>
internal sealed class BlogDraftWorker : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(10);

    private readonly IServiceScopeFactory _scopes;
    private readonly IGeminiClient _gemini;
    private readonly ILogger<BlogDraftWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeat;

    public BlogDraftWorker(IServiceScopeFactory scopes, IGeminiClient gemini, ILogger<BlogDraftWorker> logger, IWorkerHeartbeatTracker? heartbeat = null)
    {
        _scopes = scopes;
        _gemini = gemini;
        _logger = logger;
        _heartbeat = heartbeat;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(_gemini.IsConfigured
            ? "Blog drafting is on."
            : "Blog drafting is off: Gemini__ApiKey is not set.");

        var first = true;
        while (!stoppingToken.IsCancellationRequested)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using var scope = _scopes.CreateScope();
                var runner = scope.ServiceProvider.GetRequiredService<BlogGenerationRunner>();
                if (first)
                {
                    await runner.CloseInterruptedAsync(stoppingToken);
                    first = false;
                }
                await runner.QueueScheduledIfDueAsync(stoppingToken);
                var ran = await runner.RunNextAsync(stoppingToken);
                _heartbeat?.RecordHeartbeat("BlogDrafts", sw.ElapsedMilliseconds, "Healthy", ran ? "Wrote a batch of drafts" : "Idle");
                if (ran)
                    continue; // another batch may be waiting
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _heartbeat?.RecordHeartbeat("BlogDrafts", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Blog drafting failed.");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }
}
