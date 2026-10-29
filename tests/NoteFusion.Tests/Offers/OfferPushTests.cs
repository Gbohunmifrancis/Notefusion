using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Offers;
using NoteFusion.Application.Offers.Commands;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Application.Offers.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Infrastructure.Outreach;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using static NoteFusion.Tests.Offers.OfferFixtures;

namespace NoteFusion.Tests.Offers;

/// <summary>
/// An offer's email sent as a notification too: to the web app's subscribed browsers (and, ticked, the app's phones),
/// the same groups less buyers, never held by the email quota, the web's tap opening the offer and a phone's the app's
/// Upgrade screen, each tap counted, and its own counts beside the email's.
/// </summary>
public class OfferPushTests
{
    private static readonly DateTime Friday = new(2026, 10, 30, 10, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_round_goes_as_a_notification_to_those_with_somewhere_to_show_it_less_buyers_once()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        var browser = Account(h, "browser@example.com", "US");
        var phone = Account(h, "phone@example.com", "US");
        var buyer = Account(h, "buyer@example.com", "US");
        Account(h, "nothing@example.com", "US");
        Browser(h, browser);
        Browser(h, buyer);
        Phone(h, phone);

        Assert.Equal("OFFER_PUSH_BEFORE_EMAIL", (await Push(h, admin, offer.Id, "launch")).Error.Code);
        await Send(h, admin, offer.Id);
        Payment(h, buyer, plans.Monthly, 699, offer.Id, Midweek.AddHours(1));

        var web = await Push(h, admin, offer.Id, "launch");
        Assert.Equal(new OfferPushSentDto("launch", 1, false), web.Value);
        var rows = h.Db.OfferEmails.AsNoTracking().Where(e => e.Channel != OfferChannel.Email).ToList();
        Assert.Equal((browser.Id, OfferChannel.WebPush, OfferEmailRound.Launch), Assert.Single(rows) is var r ? (r.UserId, r.Channel, r.Round) : default);
        Assert.Contains(h.Db.AdminAuditLogs, a => a.Action == AdminAuditAction.SendOfferPush && a.Summary.Contains("1 person (web app)"));
        Assert.Equal("OFFER_PUSH_SENT", (await Push(h, admin, offer.Id, "launch", phones: true)).Error.Code);

        // The last call, phones ticked: the phone too.
        Assert.Equal("OFFER_PUSH_BEFORE_EMAIL", (await Push(h, admin, offer.Id, "lastCall")).Error.Code);
        h.Clock.UtcNow = Friday;
        await new SendOfferLastCallCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock, Settings())
            .Handle(new SendOfferLastCallCommand(offer.Id), default);
        var both = await Push(h, admin, offer.Id, "lastCall", phones: true);
        Assert.Equal(2, both.Value.Queued);
        Assert.All(h.Db.OfferEmails.Where(e => e.Round == OfferEmailRound.LastCall && e.Channel != OfferChannel.Email),
            e => Assert.Equal(OfferChannel.PhoneAndWebPush, e.Channel));
        Assert.Equal("OFFER_ROUND_UNKNOWN", (await Push(h, admin, offer.Id, "third")).Error.Code);
    }

    [Fact]
    public async Task Nobody_with_notifications_on_is_refused()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        Account(h, "nothing@example.com", "US");
        await Send(h, admin, offer.Id);
        Assert.Equal("OFFER_NO_PUSH_AUDIENCE", (await Push(h, admin, offer.Id, "launch")).Error.Code);
    }

    [Fact]
    public async Task The_worker_sends_notifications_first_and_outside_the_email_quota_each_opening_its_own_place()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        var grace = Account(h, "grace@example.com", "GB");
        Browser(h, grace);
        Phone(h, grace);
        await Send(h, admin, offer.Id);
        h.Clock.UtcNow = Friday;
        await new SendOfferLastCallCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock, Settings())
            .Handle(new SendOfferLastCallCommand(offer.Id), default);
        await Push(h, admin, offer.Id, "lastCall", phones: true);

        // No room for optional mail: the emails wait, the notification goes.
        var sent = await Run(h, new NoRoom());
        Assert.Equal(1, sent);
        var row = h.Db.OfferEmails.AsNoTracking().Single(e => e.UserId == grace.Id && e.Channel == OfferChannel.PhoneAndWebPush);
        Assert.Equal(OfferEmailStatus.Sent, row.Status);
        Assert.Empty(h.Email.Offers);

        var (to, web) = Assert.Single(h.WebPush.Sent);
        Assert.Equal(grace.Id, to);
        Assert.Equal(("🎃 Last call: 30% off Pro is almost gone", "When the clock strikes midnight, Pro goes back to its usual price."), (web.Title, web.Body));
        Assert.Equal(($"/app?offer=halloween-2026&m={row.Token}", "offer", "nf-offer-halloween-2026-last-call"), (web.Url, web.Kind, web.Tag));

        var (tokens, message) = Assert.Single(h.Push.DeviceSends);
        Assert.Equal([$"ExponentPushToken[{grace.Id:N}]"], tokens);
        Assert.Equal("Upgrade", message.Data!["screen"]);
        Assert.Equal(row.Token, message.Data["offerToken"]);
        Assert.DoesNotContain(message.Data.Values, v => v.Contains("http", StringComparison.Ordinal));

        // The tap is counted like the email's button, and the notification has its own counts.
        await new RecordOfferClickCommandHandler(h.Db, new FixedClock(Friday.AddHours(1))).Handle(new RecordOfferClickCommand(row.Token), default);
        var progress = (await Queries(h).Handle(new GetOfferProgressQuery(offer.Id), default)).Value;
        Assert.Equal(new OfferPushProgressDto("lastCall", true, 0, 1, 0, 0, 1), Assert.Single(progress.Notifications!));
        Assert.Equal(0, progress.LastCall!.Sent); // the last call's email is still waiting for room
        var tapped = (await new GetOfferRecipientsQueryHandler(h.Db).Handle(new GetOfferRecipientsQuery(offer.Id, "lastCall", "opened", 0, "push"), default)).Value;
        Assert.Equal(("push", "grace@example.com"), (tapped.Channel, Assert.Single(tapped.Items).Email));
        Assert.Equal("OFFER_CHANNEL_UNKNOWN", (await new GetOfferRecipientsQueryHandler(h.Db).Handle(new GetOfferRecipientsQuery(offer.Id, "launch", null, 0, "sms"), default)).Error.Code);
    }

    [Fact]
    public async Task A_web_only_notification_never_reaches_a_phone_and_one_with_nowhere_to_go_is_skipped()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        var grace = Account(h, "grace@example.com", "GB");
        Browser(h, grace);
        Phone(h, grace);
        await Send(h, admin, offer.Id);
        await Push(h, admin, offer.Id, "launch");
        // Turned notifications off after the queue was made.
        h.Db.WebPushSubscriptions.RemoveRange(h.Db.WebPushSubscriptions);
        h.Db.SaveChanges();

        await Run(h, new NoRoom(), webPush: new NobodyWebPush());

        Assert.Empty(h.Push.DeviceSends);
        var row = h.Db.OfferEmails.AsNoTracking().Single(e => e.Channel == OfferChannel.WebPush);
        Assert.Equal((OfferEmailStatus.Skipped, OfferSkipReason.NoDevice), (row.Status, row.SkipReason));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static void Browser(TestHarness h, User user)
    {
        h.Db.WebPushSubscriptions.Add(WebPushSubscription.Create(
            user.Id, $"https://fcm.googleapis.com/fcm/send/{user.Id:N}", NoteFusion.Tests.Push.WebPushTests.BrowserKey, NoteFusion.Tests.Push.WebPushTests.BrowserAuth, null, h.Clock.UtcNow));
        h.Db.SaveChanges();
    }

    private static void Phone(TestHarness h, User user)
    {
        h.Db.DeviceTokens.Add(DeviceToken.Create(user.Id, $"ExponentPushToken[{user.Id:N}]", "android", 1, h.Clock.UtcNow));
        h.Db.SaveChanges();
    }

    private static StubCurrentUser Caller(User admin) => new(admin.Id, UserRole.Admin, admin.Email, admin.FullName);

    private static Task<Result<AdminOfferDto>> Send(TestHarness h, User admin, Guid id)
        => new SendOfferCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock, Settings())
            .Handle(new SendOfferCommand(id, true, true, false), default);

    private static Task<Result<OfferPushSentDto>> Push(TestHarness h, User admin, Guid id, string round, bool phones = false)
        => new SendOfferPushCommandHandler(h.Db, h.AuditAs(admin), h.Clock).Handle(new SendOfferPushCommand(id, round, phones), default);

    private static Task<int> Run(TestHarness h, IEmailQuota quota, IWebPushSender? webPush = null)
        => new OfferEmailService(
                h.Db, h.Clock, h.Email, new OfferSettings { PostalAddress = PostalAddress, BatchSize = 200 },
                new HmacEmailUnsubscribeTokens(h.Keys), quota: quota, push: h.Push, webPush: webPush ?? h.WebPush)
            .RunAsync(default);

    private static AdminOfferQueryHandlers Queries(TestHarness h)
        => new(h.Db, h.Clock, Settings(),
            new OfferEmailRenderer(new BrandedEmailTemplate(new EmailSettings { PostalAddress = PostalAddress })),
            new EmailQuotaSettings());

    /// <summary>Web push with no browser subscribed.</summary>
    private sealed class NobodyWebPush : IWebPushSender
    {
        public Task<WebPushReport> SendAsync(Guid userId, WebPushNotification notification, CancellationToken ct = default, string audience = "app")
            => Task.FromResult(WebPushReport.NoBrowsers);
    }
}
