using System.Diagnostics;
using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Outreach;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Api;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Billing.Gateways;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Infrastructure.Geo;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Infrastructure.Push;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using NSubstitute;

namespace NoteFusion.Tests.Http;

/// <summary>
/// Every outside HTTP call goes through <see cref="OutboundResilience"/>: an open breaker or a call that runs out
/// of time comes back as the client's own "unavailable" result (never an exception, never a 500); only requests
/// safe to repeat are retried; and a provider that hangs is given up on within the total timeout. Driven through
/// a real container with the provider presets (timeouts shortened where the test waits on them) and a scripted
/// socket, so what is tested is the pipeline as it is wired, not a copy of it.
/// </summary>
public class OutboundResilienceTests
{
    /// <summary>Generous against the shortened 0.6-second totals below, tight against the real ones.</summary>
    private static readonly TimeSpan GaveUpWithin = TimeSpan.FromSeconds(4);

    // ---------------------------------------------------------------- payments

    public static TheoryData<string> Gateways => new() { "paystack", "bachs", "flutterwave" };

    [Theory]
    [MemberData(nameof(Gateways))]
    public async Task An_open_payment_breaker_is_a_handled_unavailable_result_and_nothing_is_sent(string name)
    {
        var socket = StubHttpMessageHandler.Returning(HttpStatusCode.InternalServerError, "{}");
        using var rig = new Rig(socket, Short(OutboundResilience.Payment(Provider(name))), BaseAddress(name));
        var gateway = Gateway(name, rig.Http);

        await rig.TripAsync(() => gateway.InitiateAsync(Initiation(), default));
        var sent = socket.Requests.Count;

        var initiated = await gateway.InitiateAsync(Initiation(), default);
        var verified = await gateway.VerifyAsync(Verification(), default);

        Assert.Equal(ProviderErrors.Unavailable, initiated.Error);
        Assert.Equal(ProviderErrors.Unavailable, verified.Error);
        Assert.Equal(sent, socket.Requests.Count);
    }

    [Theory]
    [MemberData(nameof(Gateways))]
    public async Task A_hanging_payment_provider_is_given_up_on_within_the_total_timeout(string name)
    {
        var socket = new HangingHandler();
        using var rig = new Rig(socket, Short(OutboundResilience.Payment(Provider(name))), BaseAddress(name));
        var gateway = Gateway(name, rig.Http);

        var clock = Stopwatch.StartNew();
        var initiated = await gateway.InitiateAsync(Initiation(), default);
        var verified = await gateway.VerifyAsync(Verification(), default);

        Assert.True(clock.Elapsed < GaveUpWithin, $"took {clock.Elapsed}");
        // Network: the checkout leaves the transaction pending for the same reference to be replayed.
        Assert.Equal(ErrorType.Network, initiated.Error.Type);
        Assert.Equal(ErrorType.Network, verified.Error.Type);
        Assert.DoesNotContain("Exception", initiated.Error.Message);
    }

    [Theory]
    [MemberData(nameof(Gateways))]
    public async Task Starting_a_charge_is_never_retried_but_verifying_one_is(string name)
    {
        var socket = StubHttpMessageHandler.Returning(HttpStatusCode.ServiceUnavailable, "{}");
        using var rig = new Rig(socket, OutboundResilience.Payment(Provider(name)) with { RetryDelay = TimeSpan.FromMilliseconds(5) },
            BaseAddress(name));
        var gateway = Gateway(name, rig.Http);

        await gateway.InitiateAsync(Initiation(), default);
        Assert.Single(socket.Requests, r => r.Method == HttpMethod.Post);

        await gateway.VerifyAsync(Verification(), default);
        Assert.Equal(3, socket.Requests.Count(r => r.Method == HttpMethod.Get)); // the first try and two retries
    }

    [Fact]
    public async Task A_verification_that_succeeds_on_retry_is_a_success()
    {
        var socket = new StubHttpMessageHandler((_, attempt) => attempt == 1
            ? StubHttpMessageHandler.Respond(HttpStatusCode.ServiceUnavailable, "{}")
            : StubHttpMessageHandler.Respond(HttpStatusCode.OK,
                """{"status":true,"data":{"status":"success","amount":999,"currency":"USD","id":42}}"""));
        using var rig = new Rig(socket, OutboundResilience.Payment(PaymentProvider.Paystack) with { RetryDelay = TimeSpan.FromMilliseconds(5) },
            BaseAddress("paystack"));

        var verified = await Gateway("paystack", rig.Http).VerifyAsync(Verification(), default);

        Assert.True(verified.IsSuccess);
        Assert.True(verified.Value.Succeeded);
        Assert.Equal(2, socket.Requests.Count);
    }

    // ---------------------------------------------------------------- email

    [Fact]
    public async Task An_email_retry_resends_the_same_idempotency_key_and_each_message_has_its_own()
    {
        var socket = new StubHttpMessageHandler((_, attempt) => attempt == 1
            ? StubHttpMessageHandler.Respond(HttpStatusCode.ServiceUnavailable, "{}")
            : StubHttpMessageHandler.Respond(HttpStatusCode.OK, """{"id":"em_1"}"""));
        using var rig = new Rig(socket, OutboundResilience.Email with { RetryDelay = TimeSpan.FromMilliseconds(5) });
        var transport = Transport(rig.Http);

        await transport.SendAsync(Message(), default);
        await transport.SendAsync(Message(), default);

        Assert.Equal(3, socket.Requests.Count);
        var keys = socket.Requests.Select(r => r.Headers[ResendEmailTransport.IdempotencyKeyHeader]).ToList();
        Assert.False(string.IsNullOrWhiteSpace(keys[0]));
        Assert.Equal(keys[0], keys[1]); // the retry of the first message
        Assert.NotEqual(keys[0], keys[2]); // the second message
        Assert.Equal(socket.Requests[0].Body, socket.Requests[1].Body);
    }

    [Fact]
    public async Task An_open_email_breaker_is_reported_as_unavailable_so_outreach_keeps_the_message()
    {
        var socket = StubHttpMessageHandler.Returning(HttpStatusCode.InternalServerError, "{}");
        using var rig = new Rig(socket, Short(OutboundResilience.Email));
        var transport = Transport(rig.Http);

        await rig.TripAsync(async () =>
            await Assert.ThrowsAsync<EmailDeliveryException>(() => transport.SendAsync(Message(), default)));
        var sent = socket.Requests.Count;

        var refused = await Assert.ThrowsAsync<EmailDeliveryException>(() => transport.SendAsync(Message(), default));
        Assert.True(refused.ProviderUnavailable);

        var sender = new EmailSender(new BrandedEmailTemplate(new EmailSettings()), transport, NullLogger<EmailSender>.Instance);
        var outreach = await sender.SendOutreachAsync(
            new EmailRecipient("ada@example.com", "Ada"),
            new OutreachEmail(OutreachSegment.NeverTranscribed, "Francis", "hello@notefusion.studio", "https://x/unsubscribe"));
        Assert.Equal(ProviderErrors.Unavailable, outreach.Error);

        // Transactional mail stays best-effort: logged, never thrown.
        await sender.SendWelcomeAsync(new EmailRecipient("ada@example.com", "Ada"));
        Assert.Equal(sent, socket.Requests.Count);
    }

    [Fact]
    public async Task A_hanging_email_provider_fails_the_send_within_the_total_timeout()
    {
        using var rig = new Rig(new HangingHandler(), Short(OutboundResilience.Email));

        var clock = Stopwatch.StartNew();
        var failed = await Assert.ThrowsAsync<EmailDeliveryException>(() => Transport(rig.Http).SendAsync(Message(), default));

        Assert.True(clock.Elapsed < GaveUpWithin, $"took {clock.Elapsed}");
        Assert.False(failed.ProviderUnavailable);
    }

    // ---------------------------------------------------------------- push

    [Fact]
    public async Task Push_is_never_retried_never_throws_and_stops_calling_while_the_breaker_is_open()
    {
        var socket = StubHttpMessageHandler.Returning(HttpStatusCode.ServiceUnavailable, "{}");
        using var rig = new Rig(socket, Short(OutboundResilience.Push));
        var push = Push(rig.Http);

        await push.SendAsync([Guid.NewGuid()], new PushMessage("t", "b"));
        Assert.Single(socket.Requests);

        await rig.TripAsync(() => push.SendAsync([Guid.NewGuid()], new PushMessage("t", "b")));
        var sent = socket.Requests.Count;
        await push.SendAsync([Guid.NewGuid()], new PushMessage("t", "b"));
        Assert.Equal(sent, socket.Requests.Count);
    }

    [Fact]
    public async Task A_hanging_push_service_is_given_up_on_within_the_total_timeout()
    {
        using var rig = new Rig(new HangingHandler(), Short(OutboundResilience.Push));

        var clock = Stopwatch.StartNew();
        await Push(rig.Http).SendAsync([Guid.NewGuid()], new PushMessage("t", "b"));

        Assert.True(clock.Elapsed < GaveUpWithin, $"took {clock.Elapsed}");
    }

    // ---------------------------------------------------------------- transcription worker

    [Fact]
    public async Task A_submit_is_never_retried_but_a_status_poll_is()
    {
        var socket = StubHttpMessageHandler.Returning(HttpStatusCode.InternalServerError, "{}");
        using var rig = new Rig(socket, OutboundResilience.Transcription with { RetryDelay = TimeSpan.FromMilliseconds(5) },
            "http://worker/");
        var api = Transcriber(rig.Http);

        var submitted = await api.SubmitAsync(new MemoryStream([1, 2, 3]), "take.wav", new TranscribeOptions());
        Assert.Single(socket.Requests);
        Assert.Equal(TranscriptionErrors.ServiceUnavailable, submitted.Error);

        await api.GetJobAsync("job-1");
        Assert.Equal(3, socket.Requests.Count(r => r.Method == HttpMethod.Get));
    }

    [Fact]
    public async Task A_full_worker_queue_does_not_open_the_breaker_but_an_outage_does_and_is_a_plain_sentence()
    {
        var busy = true;
        var socket = new StubHttpMessageHandler((_, _) => StubHttpMessageHandler.Respond(
            busy ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.InternalServerError, "{}"));
        using var rig = new Rig(socket, Short(OutboundResilience.Transcription) with { MaxRetryAttempts = 0 }, "http://worker/");
        var api = Transcriber(rig.Http);

        for (var i = 0; i < 5; i++)
            await api.SubmitAsync(new MemoryStream([1]), "take.wav", new TranscribeOptions());
        Assert.False(rig.Open); // 503 is the worker saying its queue is full: it is answering

        busy = false;
        await rig.TripAsync(() => api.GetJobAsync("job-1"));
        var sent = socket.Requests.Count;

        var polled = await api.GetJobAsync("job-1");
        var submitted = await api.SubmitAsync(new MemoryStream([1]), "take.wav", new TranscribeOptions());
        var resolved = await api.ResolveLinkAsync("https://youtu.be/x");

        Assert.Equal(sent, socket.Requests.Count);
        Assert.Equal(ErrorType.Network, polled.Error.Type);
        Assert.Equal(TranscriptionErrors.ServiceUnavailable.Message, polled.Error.Message);
        Assert.Equal(TranscriptionErrors.ServiceUnavailable.Message, submitted.Error.Message);
        Assert.Equal(TranscriptionErrors.ServiceUnavailable, resolved.Error);
    }

    [Fact]
    public async Task A_hanging_worker_is_given_up_on_within_the_total_timeout()
    {
        using var rig = new Rig(new HangingHandler(), Short(OutboundResilience.Transcription), "http://worker/");
        var api = Transcriber(rig.Http);

        var clock = Stopwatch.StartNew();
        var polled = await api.GetJobAsync("job-1");
        var submitted = await api.SubmitAsync(new MemoryStream([1]), "take.wav", new TranscribeOptions());

        Assert.True(clock.Elapsed < GaveUpWithin * 2, $"took {clock.Elapsed}");
        Assert.Equal(ErrorType.Network, polled.Error.Type);
        Assert.Equal(ErrorType.Network, submitted.Error.Type);
    }

    [Fact]
    public async Task The_callers_own_cancellation_still_cancels()
    {
        using var rig = new Rig(new HangingHandler(), OutboundResilience.Transcription, "http://worker/");
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Transcriber(rig.Http).GetJobAsync("job-1", cts.Token));
    }

    // ---------------------------------------------------------------- geo

    [Fact]
    public async Task An_open_geo_breaker_is_an_unknown_country_without_asking()
    {
        var socket = StubHttpMessageHandler.Returning(HttpStatusCode.BadGateway, "");
        using var rig = new Rig(socket, Short(OutboundResilience.GeoIp));
        var geo = Geo(rig.Http);

        await rig.TripAsync(() => geo.CountryForAsync("203.0.113.9"));
        var sent = socket.Requests.Count;

        Assert.Null(await geo.CountryForAsync("203.0.113.9"));
        Assert.Equal(sent, socket.Requests.Count);
    }

    [Fact]
    public async Task A_hanging_geo_service_is_an_unknown_country_within_the_timeout()
    {
        using var rig = new Rig(new HangingHandler(), Short(OutboundResilience.GeoIp));

        var clock = Stopwatch.StartNew();
        Assert.Null(await Geo(rig.Http).CountryForAsync("203.0.113.9"));
        Assert.True(clock.Elapsed < GaveUpWithin, $"took {clock.Elapsed}");
    }

    // ---------------------------------------------------------------- health

    [Fact]
    public void An_open_breaker_reads_as_available_again_once_its_break_has_passed()
    {
        var time = new ManualTime();
        var health = new CircuitProviderHealth(time);

        health.Opened("resend", TimeSpan.FromSeconds(30));
        Assert.True(health.IsUnavailable("resend"));
        Assert.False(health.IsUnavailable("expo"));

        // Polly half-opens only on the next call, which a waiting batch would never make.
        time.Now += TimeSpan.FromSeconds(31);
        Assert.False(health.IsUnavailable("resend"));

        health.Opened("resend", TimeSpan.FromSeconds(30));
        health.Closed("resend");
        Assert.False(health.IsUnavailable("resend"));
    }

    [Fact]
    public void Every_outside_client_in_the_container_gets_the_pipeline_and_no_HttpClient_timeout()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Paystack:SecretKey"] = "sk",
            ["Paystack:BaseUrl"] = "https://api.paystack.co",
        }).Build();
        var services = new ServiceCollection();
        services.AddSingleton<IDateTimeProvider>(new FixedClock(DateTime.UtcNow));
        services.AddBilling(configuration);
        using var provider = services.BuildServiceProvider();

        var http = provider.GetRequiredService<IHttpClientFactory>().CreateClient("paystack");
        Assert.Equal(Timeout.InfiniteTimeSpan, http.Timeout);
        Assert.Same(provider.GetRequiredService<IProviderHealth>(), provider.GetRequiredService<CircuitProviderHealth>());
    }

    [Fact]
    public async Task An_open_breaker_no_client_handled_is_a_503_with_a_plain_sentence_not_a_500()
    {
        var middleware = new NoteFusion.Api.Middleware.ExceptionHandlingMiddleware(
            _ => throw new Polly.CircuitBreaker.BrokenCircuitException("The circuit is now open and is not allowing calls."),
            NullLogger<NoteFusion.Api.Middleware.ExceptionHandlingMiddleware>.Instance);
        var context = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        context.Response.Body = new MemoryStream();

        await middleware.InvokeAsync(context);

        Assert.Equal(503, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();
        Assert.Contains(ProviderErrors.UnavailableCode, body);
        Assert.DoesNotContain("circuit", body, StringComparison.OrdinalIgnoreCase);
    }

    // ---------------------------------------------------------------- fixtures

    /// <summary>The preset with timeouts short enough to wait on and a breaker that opens after two failures.</summary>
    private static OutboundResilienceOptions Short(OutboundResilienceOptions preset) => preset with
    {
        AttemptTimeout = TimeSpan.FromMilliseconds(200),
        ReadAttemptTimeout = preset.ReadAttemptTimeout is null ? null : TimeSpan.FromMilliseconds(200),
        TotalTimeout = TimeSpan.FromMilliseconds(600),
        RetryDelay = TimeSpan.FromMilliseconds(5),
        MinimumThroughput = 2,
    };

    private static PaymentProvider Provider(string name) => Enum.Parse<PaymentProvider>(name, ignoreCase: true);

    private static string BaseAddress(string name) => name switch
    {
        "paystack" => "https://api.paystack.co",
        "bachs" => "https://sandbox-api.bachs.io",
        _ => "https://api.flutterwave.com",
    };

    private static IPaymentGateway Gateway(string name, HttpClient http) => name switch
    {
        "paystack" => new PaystackPaymentGateway(http,
            new PaymentProviderOptions { SecretKey = "sk", BaseUrl = BaseAddress(name), SupportedCurrencies = "USD" },
            NullLogger<PaystackPaymentGateway>.Instance),
        "bachs" => new BachsPaymentGateway(http,
            new BachsOptions { SecretKey = "sk", BaseUrl = BaseAddress(name), WebhookSecret = "whsec", SupportedCurrencies = "USD" },
            NullLogger<BachsPaymentGateway>.Instance),
        _ => new FlutterwavePaymentGateway(http,
            new PaymentProviderOptions { SecretKey = "sk", BaseUrl = BaseAddress(name), SupportedCurrencies = "USD" },
            NullLogger<FlutterwavePaymentGateway>.Instance),
    };

    private static GatewayInitiationRequest Initiation() => new(
        "NF_resilience", 999, "USD", "jane@example.com", "https://api.test/api/billing/return",
        Recurring: false, IdempotencyKey: "checkout:NF_resilience", PlanCode: "pro_monthly_usd", CustomerName: "Jane Doe");

    private static GatewayVerificationRequest Verification() => new("NF_resilience", "12345");

    private static ResendEmailTransport Transport(HttpClient http)
        => new(new EmailSettings { UseResend = true, ApiKey = "re_test" }, NullLogger<ResendEmailTransport>.Instance, http);

    private static EmailMessage Message() => new("ada@example.com", "Ada", "Hello", "<p>Hi</p>", "Hi");

    private static ExpoPushSender Push(HttpClient http)
    {
        var tokens = Substitute.For<IDeviceTokenService>();
        tokens.ResolveTokensAsync(Arg.Any<IReadOnlyList<Guid>>(), Arg.Any<CancellationToken>())
            .Returns(["ExponentPushToken[abc]"]);
        return new ExpoPushSender(tokens, NullLogger<ExpoPushSender>.Instance, http);
    }

    private static TranscriptionApiClient Transcriber(HttpClient http)
        => new(http, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);

    private static HttpGeoIpLookup Geo(HttpClient http)
        => new(http, new GeoSettings { LookupUrl = "https://geo.test/{ip}/country/" }, NullLogger<HttpGeoIpLookup>.Instance);

    /// <summary>One provider's client, built by the container exactly as production builds it.</summary>
    private sealed class Rig : IDisposable
    {
        private readonly ServiceProvider _services;
        private readonly string _provider;

        public Rig(HttpMessageHandler socket, OutboundResilienceOptions options, string? baseAddress = null)
        {
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddHttpClient("rig", client =>
                {
                    if (baseAddress is not null)
                        client.BaseAddress = new Uri(baseAddress);
                })
                .ConfigurePrimaryHttpMessageHandler(() => socket)
                .AddOutboundResilience(options);
            _services = services.BuildServiceProvider();
            _provider = options.Provider;
            Http = _services.GetRequiredService<IHttpClientFactory>().CreateClient("rig");
        }

        public HttpClient Http { get; }

        public bool Open => _services.GetRequiredService<IProviderHealth>().IsUnavailable(_provider);

        /// <summary>Fails calls until the breaker opens.</summary>
        public async Task TripAsync(Func<Task> call)
        {
            for (var i = 0; i < 10 && !Open; i++)
                await call();
            Assert.True(Open, "the breaker should have opened");
        }

        public void Dispose() => _services.Dispose();
    }

    /// <summary>A provider that accepts the connection and never answers.</summary>
    private sealed class HangingHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            await Task.Delay(Timeout.Infinite, ct);
            throw new UnreachableException();
        }
    }

    private sealed class ManualTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 15, 9, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
