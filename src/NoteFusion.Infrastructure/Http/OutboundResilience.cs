using System.Collections.Concurrent;
using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Http.Resilience;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using Polly;

namespace NoteFusion.Infrastructure.Http;

/// <summary>
/// How one outside provider's HttpClient is protected: how long one attempt and the whole call may take,
/// what may be retried, and when to stop calling it for a while.
/// </summary>
internal sealed record OutboundResilienceOptions
{
    /// <summary>One of <see cref="OutboundProviders"/>; names the pipeline and the breaker's health entry.</summary>
    public required string Provider { get; init; }

    /// <summary>One attempt, for any request that has no <see cref="ReadAttemptTimeout"/>.</summary>
    public required TimeSpan AttemptTimeout { get; init; }

    /// <summary>One attempt of a GET/HEAD, when reads should give up sooner than writes (status polls beside uploads).</summary>
    public TimeSpan? ReadAttemptTimeout { get; init; }

    /// <summary>The whole call, retries and their waits included. This, not HttpClient.Timeout, is the limit.</summary>
    public required TimeSpan TotalTimeout { get; init; }

    /// <summary>Retries after the first attempt. Only requests that are safe to repeat are ever retried.</summary>
    public int MaxRetryAttempts { get; init; }

    public TimeSpan RetryDelay { get; init; } = TimeSpan.FromSeconds(1);

    /// <summary>
    /// Retry a POST that carries an <c>Idempotency-Key</c> header, for a provider that documents that a repeat
    /// with the same key is answered without acting twice (Resend). Off by default: without it only GET,
    /// HEAD and OPTIONS are retried.
    /// </summary>
    public bool RetryKeyedWrites { get; init; }

    /// <summary>
    /// Whether a 429 or 503 counts against the breaker. The transcription worker answers 503 when its queue
    /// is full, which is it working, not failing: opening its breaker for that would also refuse the status
    /// polls of the jobs it is busy with.
    /// </summary>
    public bool BusyCountsAsFailure { get; init; } = true;

    /// <summary>
    /// One breaker (and pipeline) per host rather than one for the provider, for a client that calls several
    /// independent services (web push: FCM, Mozilla, Apple, WNS), so one being down does not stop the others.
    /// </summary>
    public bool PerAuthority { get; init; }

    public double FailureRatio { get; init; } = 0.5;
    public int MinimumThroughput { get; init; } = 5;
    public TimeSpan SamplingDuration { get; init; } = TimeSpan.FromSeconds(60);
    public TimeSpan BreakDuration { get; init; } = TimeSpan.FromSeconds(30);
}

/// <summary>
/// The one resilience shape every outside HTTP call shares: a total timeout, then retries (of requests safe
/// to repeat only), then a circuit breaker, then a per-attempt timeout. HttpClient.Timeout is turned off so
/// the total timeout governs. A call that is refused or times out throws Polly's
/// <see cref="Polly.ExecutionRejectedException"/> (<c>BrokenCircuitException</c>,
/// <c>TimeoutRejectedException</c>), which each client turns into its own "unavailable" result.
/// </summary>
internal static class OutboundResilience
{
    private const string IdempotencyKeyHeader = "Idempotency-Key";

    /// <summary>
    /// Payments. A charge-starting POST is never retried here: the checkout leaves its transaction pending on
    /// a network error and the next attempt replays the same reference and key, so a retry only adds wait
    /// for a person standing at the checkout. Verification GETs are retried.
    /// </summary>
    public static OutboundResilienceOptions Payment(PaymentProvider provider) => new()
    {
        Provider = OutboundProviders.Payment(provider),
        AttemptTimeout = TimeSpan.FromSeconds(10),
        TotalTimeout = TimeSpan.FromSeconds(25),
        MaxRetryAttempts = 2,
    };

    /// <summary>Resend sends: retried only with an Idempotency-Key, which Resend honours for 24 hours.</summary>
    public static readonly OutboundResilienceOptions Email = new()
    {
        Provider = OutboundProviders.Email,
        AttemptTimeout = TimeSpan.FromSeconds(8),
        TotalTimeout = TimeSpan.FromSeconds(20),
        MaxRetryAttempts = 2,
        RetryKeyedWrites = true,
    };

    /// <summary>The admin inbox: reads only.</summary>
    public static readonly OutboundResilienceOptions EmailInbox = new()
    {
        Provider = OutboundProviders.EmailInbox,
        AttemptTimeout = TimeSpan.FromSeconds(8),
        TotalTimeout = TimeSpan.FromSeconds(20),
        MaxRetryAttempts = 2,
    };

    /// <summary>Expo push: one POST, not repeatable (a retry could notify twice).</summary>
    public static readonly OutboundResilienceOptions Push = new()
    {
        Provider = OutboundProviders.Push,
        AttemptTimeout = TimeSpan.FromSeconds(5),
        TotalTimeout = TimeSpan.FromSeconds(10),
    };

    /// <summary>Expo's receipts: a read sent as a POST, asked again on the next run rather than retried.</summary>
    public static readonly OutboundResilienceOptions PushReceipts = new()
    {
        Provider = OutboundProviders.PushReceipts,
        AttemptTimeout = TimeSpan.FromSeconds(5),
        TotalTimeout = TimeSpan.FromSeconds(10),
    };

    /// <summary>
    /// Web push (RFC 8030): one POST per browser, not repeatable (a retry could notify twice), with a breaker
    /// per push service.
    /// </summary>
    public static readonly OutboundResilienceOptions WebPush = new()
    {
        Provider = OutboundProviders.WebPush,
        AttemptTimeout = TimeSpan.FromSeconds(5),
        TotalTimeout = TimeSpan.FromSeconds(10),
        PerAuthority = true,
    };

    /// <summary>
    /// The transcription worker. Submits, grades and harmonies are POSTs that do work and are never repeated;
    /// they keep the old 100-second limit (a 25 MB upload on the internal network, or a synchronous grade).
    /// Status polls and the health check are GETs: 15 seconds an attempt, retried.
    /// </summary>
    public static readonly OutboundResilienceOptions Transcription = new()
    {
        Provider = OutboundProviders.Transcription,
        AttemptTimeout = TimeSpan.FromSeconds(100),
        ReadAttemptTimeout = TimeSpan.FromSeconds(15),
        TotalTimeout = TimeSpan.FromSeconds(120),
        MaxRetryAttempts = 2,
        BusyCountsAsFailure = false,
    };

    /// <summary>Geo IP on sign-up: three seconds at most, and no calls at all while it is down.</summary>
    public static readonly OutboundResilienceOptions GeoIp = new()
    {
        Provider = OutboundProviders.GeoIp,
        AttemptTimeout = TimeSpan.FromSeconds(3),
        TotalTimeout = TimeSpan.FromSeconds(3),
    };

    /// <summary>
    /// The Gemini API (blog drafts). A draft is one slow POST — a thinking model can take a couple of minutes —
    /// never repeated here: the drafter paces its own retries (up to five tries, 15/30/60/60 s apart, then the
    /// fallback models), so the total timeout is one attempt's. Gemini's "high demand" 503s and its 429s are it
    /// being busy, not broken: they do not count against the breaker (as with the transcriber), so a bad spell
    /// of 503s cannot lock the next minutes' drafts out. Timeouts, dropped connections and other 5xx do count;
    /// when the breaker opens, the batch stops and says so in its row.
    /// </summary>
    public static readonly OutboundResilienceOptions Gemini = new()
    {
        Provider = OutboundProviders.Gemini,
        AttemptTimeout = TimeSpan.FromSeconds(240),
        TotalTimeout = TimeSpan.FromSeconds(250),
        MinimumThroughput = 3,
        BreakDuration = TimeSpan.FromMinutes(2),
        BusyCountsAsFailure = false,
    };

    /// <summary>GitHub's REST API: the deploy workflow's dispatch (a POST, not repeated) and its latest run (a GET).</summary>
    public static readonly OutboundResilienceOptions GitHub = new()
    {
        Provider = OutboundProviders.GitHub,
        AttemptTimeout = TimeSpan.FromSeconds(10),
        TotalTimeout = TimeSpan.FromSeconds(25),
        MaxRetryAttempts = 2,
    };

    /// <summary>The public website's own files (the blog catalogue): reads only.</summary>
    public static readonly OutboundResilienceOptions Website = new()
    {
        Provider = OutboundProviders.Website,
        AttemptTimeout = TimeSpan.FromSeconds(10),
        TotalTimeout = TimeSpan.FromSeconds(25),
        MaxRetryAttempts = 2,
    };

    /// <summary>
    /// Sentry's REST API for the console's Sessions page: reads only, so they are retried. A recording's video pieces
    /// are small (a few hundred KB) and read one at a time as the player reaches them.
    /// </summary>
    public static readonly OutboundResilienceOptions SentryApi = new()
    {
        Provider = OutboundProviders.SentryApi,
        AttemptTimeout = TimeSpan.FromSeconds(15),
        TotalTimeout = TimeSpan.FromSeconds(35),
        MaxRetryAttempts = 2,
    };

    /// <summary>Registers the shared breaker-state tracker (idempotent).</summary>
    public static IServiceCollection AddProviderHealth(this IServiceCollection services)
    {
        services.TryAddSingleton(_ => new CircuitProviderHealth(TimeProvider.System));
        services.TryAddSingleton<IProviderHealth>(sp => sp.GetRequiredService<CircuitProviderHealth>());
        return services;
    }

    /// <summary>Attaches the shared pipeline to a client and lets the pipeline's total timeout govern.</summary>
    public static IHttpClientBuilder AddOutboundResilience(this IHttpClientBuilder builder, OutboundResilienceOptions options)
    {
        builder.Services.AddProviderHealth();
        builder.ConfigureHttpClient(client => client.Timeout = Timeout.InfiniteTimeSpan);
        var handler = builder.AddResilienceHandler(options.Provider, (pipeline, context) =>
            Configure(pipeline, options, context.ServiceProvider.GetRequiredService<CircuitProviderHealth>()));
        if (options.PerAuthority)
            handler.SelectPipelineByAuthority();
        // Inside the pipeline, so it sees each attempt that actually left: see OutboundFailure.NothingSent.
        builder.AddHttpMessageHandler(() => new AttemptMarker());
        return builder;
    }

    internal static void Configure(
        ResiliencePipelineBuilder<HttpResponseMessage> pipeline, OutboundResilienceOptions options, CircuitProviderHealth health)
    {
        pipeline.AddTimeout(new HttpTimeoutStrategyOptions { Name = "Total", Timeout = options.TotalTimeout });

        if (options.MaxRetryAttempts > 0)
        {
            pipeline.AddRetry(new HttpRetryStrategyOptions
            {
                MaxRetryAttempts = options.MaxRetryAttempts,
                Delay = options.RetryDelay,
                BackoffType = DelayBackoffType.Exponential,
                UseJitter = true,
                // 5xx, 408, 429, network errors and attempt timeouts — and only for a request safe to repeat.
                ShouldHandle = args => ValueTask.FromResult(
                    HttpClientResiliencePredicates.IsTransient(args.Outcome)
                    && IsSafeToRepeat(args.Context.GetRequestMessage(), options)),
            });
        }

        pipeline.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = options.FailureRatio,
            MinimumThroughput = options.MinimumThroughput,
            SamplingDuration = options.SamplingDuration,
            BreakDuration = options.BreakDuration,
            ShouldHandle = args => ValueTask.FromResult(
                HttpClientResiliencePredicates.IsTransient(args.Outcome)
                && (options.BusyCountsAsFailure || !IsBusy(args.Outcome.Result))),
            OnOpened = args =>
            {
                health.Opened(options.Provider, args.BreakDuration);
                return default;
            },
            // Half-open lets one probe through, so a batch may try again: if the probe fails it opens again.
            OnHalfOpened = _ =>
            {
                health.Closed(options.Provider);
                return default;
            },
            OnClosed = _ =>
            {
                health.Closed(options.Provider);
                return default;
            },
        });

        pipeline.AddTimeout(new HttpTimeoutStrategyOptions
        {
            Name = "Attempt",
            TimeoutGenerator = args => ValueTask.FromResult(
                options.ReadAttemptTimeout is { } read && IsRead(args.Context.GetRequestMessage())
                    ? read
                    : options.AttemptTimeout),
        });
    }

    private static bool IsRead(HttpRequestMessage? request)
        => request is not null && (request.Method == HttpMethod.Get || request.Method == HttpMethod.Head);

    private static bool IsSafeToRepeat(HttpRequestMessage? request, OutboundResilienceOptions options)
        => request is not null
           && (IsRead(request)
               || request.Method == HttpMethod.Options
               || (options.RetryKeyedWrites && request.Headers.Contains(IdempotencyKeyHeader)));

    private static bool IsBusy(HttpResponseMessage? response)
        => response?.StatusCode is HttpStatusCode.ServiceUnavailable or HttpStatusCode.TooManyRequests;
}

/// <summary>
/// The open/closed state of every outside provider's breaker, fed by the breakers' own callbacks. Polly only
/// moves an open breaker to half-open on the next call, so "open" here also ends when the break duration has
/// passed — otherwise a batch that waits for the breaker would wait for ever, never making the call that
/// would close it.
/// </summary>
internal sealed class CircuitProviderHealth(TimeProvider clock) : IProviderHealth
{
    private readonly ConcurrentDictionary<string, DateTimeOffset> _openUntil = new(StringComparer.OrdinalIgnoreCase);

    public bool IsUnavailable(string provider)
        => _openUntil.TryGetValue(provider, out var until) && clock.GetUtcNow() < until;

    internal void Opened(string provider, TimeSpan breakDuration) => _openUntil[provider] = clock.GetUtcNow() + breakDuration;

    internal void Closed(string provider) => _openUntil.TryRemove(provider, out _);
}

/// <summary>Marks a request once any attempt of it has gone out, below the breaker and the timeouts.</summary>
internal sealed class AttemptMarker : DelegatingHandler
{
    internal static readonly HttpRequestOptionsKey<bool> Attempted = new("NoteFusion.Outbound.Attempted");

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        request.Options.Set(Attempted, true);
        return base.SendAsync(request, cancellationToken);
    }
}
