using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Push;
using NoteFusion.Infrastructure.Push.Workers;
using NoteFusion.Tests.Support;
using NSubstitute;

namespace NoteFusion.Tests.Push;

/// <summary>
/// Expo taking a push is not the phone getting it. Its tickets used to be misread (a refusal's details are an object,
/// which threw, and the throw counted as sent), and their receipts were never read, so a missing FCM key on Expo
/// silenced every Android push while the API reported them sent. These pin the tickets, the receipts and what is done
/// with each answer.
/// </summary>
public class PushReceiptTests
{
    private static readonly DateTime Now = new(2026, 10, 18, 17, 42, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_refused_ticket_is_read_with_its_code_and_a_dead_phone_is_kept_for_dropping()
    {
        var clock = new FixedClock(Now);
        var log = new PushTicketLog(clock);
        var expo = new FakeExpo(send: _ => """
            {"data":[
              {"status":"error","message":"\"ExponentPushToken[old]\" is not a registered push notification recipient",
               "details":{"error":"DeviceNotRegistered","expoPushToken":"ExponentPushToken[old]"}}
            ]}
            """);

        var delivery = await Sender(expo, log).SendToDevicesAsync(["ExponentPushToken[old]"], new PushMessage("t", "b"));

        Assert.False(delivery.Delivered);
        Assert.Equal(PushProblems.DeviceNotRegistered, delivery.ErrorCode);
        Assert.Equal(1, delivery.Refused);
        Assert.Equal(["ExponentPushToken[old]"], log.TakeDead());
        Assert.Equal(1, log.Stats().Refused);
    }

    [Fact]
    public async Task Every_token_is_sent_a_hundred_per_request_and_each_ticket_is_tracked()
    {
        var clock = new FixedClock(Now);
        var log = new PushTicketLog(clock);
        var expo = new FakeExpo(send: body =>
        {
            var count = JsonDocument.Parse(body).RootElement.GetArrayLength();
            var tickets = Enumerable.Range(0, count).Select(_ => $"{{\"status\":\"ok\",\"id\":\"{Guid.NewGuid()}\"}}");
            return $"{{\"data\":[{string.Join(',', tickets)}]}}";
        });
        var tokens = Enumerable.Range(0, 250).Select(i => $"ExponentPushToken[{i}]").ToList();

        var delivery = await Sender(expo, log).SendToDevicesAsync(tokens, new PushMessage("t", "b"));

        Assert.Equal(3, expo.Sends.Count);
        Assert.Equal(250, delivery.Accepted);
        Assert.Equal(250, delivery.Tickets.Count);
        Assert.Equal(250, log.Waiting);
    }

    [Fact]
    public async Task The_access_token_goes_with_every_request_once_set_and_a_401_says_so()
    {
        var log = new PushTicketLog(new FixedClock(Now));
        var expo = new FakeExpo(send: _ => """{"data":[{"status":"ok","id":"t1"}]}""");
        await Sender(expo, log, "secret-token").SendToDevicesAsync(["ExponentPushToken[a]"], new PushMessage("t", "b"));
        Assert.Equal("Bearer secret-token", expo.Authorization);

        var locked = new FakeExpo(send: _ => """{"errors":[{"code":"UNAUTHORIZED"}]}""", status: HttpStatusCode.Unauthorized);
        var refused = await Sender(locked, log).SendToDevicesAsync(["ExponentPushToken[a]"], new PushMessage("t", "b"));
        Assert.Equal(PushProblems.Unauthorized, refused.ErrorCode);
        Assert.Contains("Push__ExpoAccessToken", PushProblems.Describe(refused.ErrorCode!));
    }

    [Fact]
    public async Task Receipts_settle_their_tickets_count_the_refusals_and_drop_dead_phones()
    {
        var clock = new FixedClock(Now);
        var log = new PushTicketLog(clock);
        log.Track("ok-1", "ExponentPushToken[good]");
        log.Track("bad-1", "ExponentPushToken[nokey]");
        log.Track("dead-1", "ExponentPushToken[gone]");
        log.Track("late-1", "ExponentPushToken[late]");
        clock.UtcNow = clock.UtcNow.Add(TimeSpan.FromMinutes(2));
        var expo = new FakeExpo(receipts: _ => """
            {"data":{
              "ok-1":{"status":"ok"},
              "bad-1":{"status":"error","message":"Unable to retrieve the FCM server key","details":{"error":"InvalidCredentials"}},
              "dead-1":{"status":"error","message":"not registered","details":{"error":"DeviceNotRegistered"}}
            }}
            """);
        var tokens = Substitute.For<IDeviceTokenService>();
        tokens.ForgetAsync(Arg.Any<IReadOnlyList<string>>(), Arg.Any<CancellationToken>()).Returns(1);

        var run = await Worker(expo, log, clock, tokens).RunOnceAsync(default);

        Assert.Equal(3, run.Read);
        Assert.Equal(2, run.Refused);
        Assert.Equal(1, run.Dropped);
        Assert.Equal(PushProblems.InvalidCredentials, run.Problem);
        await tokens.Received(1).ForgetAsync(
            Arg.Is<IReadOnlyList<string>>(t => t.SequenceEqual(new[] { "ExponentPushToken[gone]" })), Arg.Any<CancellationToken>());
        Assert.Equal(1, log.Waiting); // the one Google has not answered yet is asked again next run

        var stats = log.Stats();
        Assert.Equal(3, stats.Checked);
        Assert.Equal(2, stats.Refused);
        Assert.Contains("FCM V1 service account key", PushProblems.Describe(PushProblems.InvalidCredentials));
    }

    [Fact]
    public async Task A_ticket_too_young_is_left_and_one_older_than_a_day_is_given_up()
    {
        var clock = new FixedClock(Now);
        var log = new PushTicketLog(clock);
        log.Track("young", "ExponentPushToken[a]");
        var expo = new FakeExpo(receipts: _ => """{"data":{}}""");

        await Worker(expo, log, clock, Substitute.For<IDeviceTokenService>()).RunOnceAsync(default);
        Assert.Empty(expo.ReceiptAsks); // sent seconds ago: Google has not answered yet

        clock.UtcNow = clock.UtcNow.Add(TimeSpan.FromHours(25));
        await Worker(expo, log, clock, Substitute.For<IDeviceTokenService>()).RunOnceAsync(default);
        Assert.Equal(0, log.Waiting);
    }

    [Fact]
    public async Task The_test_alert_waits_for_its_own_receipt()
    {
        var log = new PushTicketLog(new FixedClock(Now));
        log.Track("t1", "ExponentPushToken[a]");
        var asks = 0;
        var expo = new FakeExpo(receipts: _ => ++asks < 2
            ? """{"data":{}}"""
            : """{"data":{"t1":{"status":"error","details":{"error":"InvalidCredentials"}}}}""");
        var receipts = new ExpoPushReceipts(new HttpClient(expo), log, NullLogger<ExpoPushReceipts>.Instance)
        {
            PollEvery = TimeSpan.FromMilliseconds(5),
        };

        var receipt = await receipts.WaitAsync("t1", TimeSpan.FromSeconds(5));

        Assert.Equal(PushProblems.InvalidCredentials, receipt?.ErrorCode);
        Assert.Equal(0, log.Waiting); // settled here, so the worker does not count it twice
        Assert.Equal(1, log.Stats().Refused);
    }

    private static ExpoPushSender Sender(FakeExpo expo, PushTicketLog log, string? accessToken = null)
        => new(Substitute.For<IDeviceTokenService>(), NullLogger<ExpoPushSender>.Instance, new HttpClient(expo), log,
            new ExpoPushSettings { ExpoAccessToken = accessToken });

    private static PushReceiptWorker Worker(FakeExpo expo, PushTicketLog log, FixedClock clock, IDeviceTokenService tokens)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IPushReceipts>(new ExpoPushReceipts(new HttpClient(expo), log, NullLogger<ExpoPushReceipts>.Instance));
        services.AddSingleton(tokens);
        var provider = services.BuildServiceProvider();
        return new PushReceiptWorker(
            provider.GetRequiredService<IServiceScopeFactory>(), log, clock, NullLogger<PushReceiptWorker>.Instance);
    }

    /// <summary>Expo's two endpoints, answering what the test says, and what was asked of them.</summary>
    private sealed class FakeExpo(
        Func<string, string>? send = null, Func<string, string>? receipts = null, HttpStatusCode status = HttpStatusCode.OK)
        : HttpMessageHandler
    {
        public List<string> Sends { get; } = [];
        public List<string> ReceiptAsks { get; } = [];
        public string? Authorization { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            Authorization = request.Headers.Authorization?.ToString();
            string answer;
            if (request.RequestUri!.AbsolutePath.EndsWith("/push/send"))
            {
                Sends.Add(body);
                answer = send!(body);
            }
            else
            {
                ReceiptAsks.Add(body);
                answer = receipts!(body);
            }
            return new HttpResponseMessage(status) { Content = new StringContent(answer, Encoding.UTF8, "application/json") };
        }
    }
}
