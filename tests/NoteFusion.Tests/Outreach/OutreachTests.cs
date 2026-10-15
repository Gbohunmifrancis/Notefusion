using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Outreach;
using NoteFusion.Application.Outreach.Commands;
using NoteFusion.Application.Outreach.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Infrastructure.Outreach;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Outreach;

/// <summary>
/// The founder's customer-research outreach: who falls in each segment, which channels reach them, the
/// once-per-segment and seven-day rules, sending hours, the batch limit, how it sits beside the abandoned
/// checkout reminder, and the unsubscribe link.
/// </summary>
public class OutreachTests
{
    /// <summary>11:00 WAT, inside sending hours.</summary>
    private static readonly DateTime Now = new(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc);

    private static OutreachSettings On(int batch = 50) => new()
    {
        Enabled = true,
        FounderName = "Francis",
        ReplyTo = "hello@notefusion.studio",
        BatchSize = batch,
    };

    // ── Segments ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_old_unpaid_checkout_gets_what_stopped_you_by_email_and_push_to_the_plans()
    {
        using var h = new TestHarness(Now);
        var ada = Account(h, "ada@example.com", "Ada Lovelace", Now.AddDays(-10), device: true);
        Checkout(h, ada, Now.AddDays(-4));

        Assert.Equal(1, await Run(h));

        var (to, email) = Assert.Single(h.Email.Outreach);
        Assert.Equal("ada@example.com", to.Email);
        Assert.Equal(OutreachSegment.CheckoutAbandoned, email.Segment);
        Assert.Equal("Francis", email.FounderName);
        Assert.Equal("hello@notefusion.studio", email.ReplyTo);
        var push = Assert.Single(h.Push.Sent);
        Assert.Equal(new[] { ada }, push.Recipients);
        Assert.Equal("Upgrade", push.Message.Data!["screen"]);
        Assert.Equal(2, h.Db.OutreachMessages.Count(m => m.UserId == ada && m.Status == OutreachStatus.Sent));
    }

    [Fact]
    public async Task No_checkout_outreach_for_a_recent_checkout_a_payment_or_Pro_and_the_account_is_held_for_it()
    {
        using var h = new TestHarness(Now);
        var plan = AddPlan(h);
        var recent = Account(h, "recent@example.com", "Recent", Now.AddDays(-10));
        Checkout(h, recent, Now.AddDays(-2), plan);
        var paid = Account(h, "paid@example.com", "Paid", Now.AddDays(-10));
        Checkout(h, paid, Now.AddDays(-5), plan, completed: true);
        var pro = Account(h, "pro@example.com", "Pro", Now.AddDays(-10));
        Checkout(h, pro, Now.AddDays(-5), plan);
        h.Db.Subscriptions.Add(Subscription.Start(pro, plan.Id, PaymentProvider.Paystack, Now.AddDays(-5), Now.AddDays(25), "sub_1", Now));
        await h.Db.SaveChangesAsync();

        // The paying accounts hear only the first-song nudge (they have not transcribed); the recent one would
        // too, but is kept for the checkout question.
        Assert.Equal(2, await Run(h));
        Assert.All(h.Email.Outreach, o => Assert.Equal(OutreachSegment.NeverTranscribed, o.Email.Segment));
        Assert.DoesNotContain(h.Email.Outreach, o => o.To.Email == "recent@example.com");

        h.Clock.UtcNow = Now.AddDays(1);
        Assert.Equal(1, await Run(h));
        Assert.Equal(("recent@example.com", OutreachSegment.CheckoutAbandoned),
            (h.Email.Outreach[2].To.Email, h.Email.Outreach[2].Email.Segment));
    }

    [Fact]
    public async Task An_active_free_user_is_asked_for_a_chat_by_transcriptions_or_by_days()
    {
        using var h = new TestHarness(Now);
        var busy = Account(h, "busy@example.com", "Busy", Now.AddDays(-8));
        for (var i = 0; i < 4; i++) Job(h, busy, Now.AddHours(-1 - i), finished: true);

        // Three separate days (WAT), none of them a finished transcription.
        var regular = Account(h, "regular@example.com", "Regular", Now.AddDays(-20));
        Job(h, regular, Now.AddDays(-10), finished: false);
        Job(h, regular, Now.AddDays(-9), finished: false);
        Seen(h, regular, Now.AddDays(-1));

        // Not enough: too new, two days only, or Pro.
        var young = Account(h, "young@example.com", "Young", Now.AddDays(-6));
        for (var i = 0; i < 5; i++) Job(h, young, Now.AddHours(-1 - i), finished: true);
        var twoDays = Account(h, "two@example.com", "Two", Now.AddDays(-20));
        Job(h, twoDays, Now.AddDays(-3), finished: true);
        Job(h, twoDays, Now.AddDays(-3).AddHours(1), finished: true);
        Job(h, twoDays, Now.AddDays(-1), finished: true);
        var pro = Account(h, "pro@example.com", "Pro", Now.AddDays(-20));
        for (var i = 0; i < 4; i++) Job(h, pro, Now.AddHours(-1 - i), finished: true);
        MakePro(h, pro);

        await Run(h);

        var active = h.Email.Outreach.Where(o => o.Email.Segment == OutreachSegment.ActiveUser).Select(o => o.To.Email).Order().ToList();
        Assert.Equal(["busy@example.com", "regular@example.com"], active);
        Assert.DoesNotContain(h.Email.Outreach, o => o.To.Email is "young@example.com" or "two@example.com" or "pro@example.com");
    }

    [Fact]
    public async Task One_transcription_then_quiet_for_five_days_is_asked_about_the_sheet_with_its_date()
    {
        using var h = new TestHarness(Now);
        var once = Account(h, "once@example.com", "Once", Now.AddDays(-12));
        var at = new DateTime(2026, 10, 7, 9, 0, 0, DateTimeKind.Utc);
        Job(h, once, at, finished: true);
        Seen(h, once, at);

        var stillAround = Account(h, "around@example.com", "Around", Now.AddDays(-12));
        Job(h, stillAround, Now.AddDays(-8), finished: true);
        Seen(h, stillAround, Now.AddDays(-2));

        var proOnce = Account(h, "pro@example.com", "Pro", Now.AddDays(-12));
        Job(h, proOnce, Now.AddDays(-8), finished: true);
        MakePro(h, proOnce);

        Assert.Equal(1, await Run(h));
        var (to, email) = Assert.Single(h.Email.Outreach);
        Assert.Equal("once@example.com", to.Email);
        Assert.Equal(OutreachSegment.TriedOnce, email.Segment);
        Assert.Equal(at, email.TriedOnUtc);

        var html = Template().Outreach(to, email).HtmlBody;
        Assert.Contains("You tried NoteFusion on 7 October", html);
    }

    [Fact]
    public async Task Never_transcribed_after_two_days_gets_the_first_song_nudge_and_a_push_to_record()
    {
        using var h = new TestHarness(Now);
        var quiet = Account(h, "quiet@example.com", "Quiet", Now.AddDays(-3), device: true);
        Account(h, "new@example.com", "New", Now.AddDays(-1), device: true);
        var failed = Account(h, "failed@example.com", "Failed", Now.AddDays(-3));
        Job(h, failed, Now.AddDays(-2), finished: false);

        Assert.Equal(1, await Run(h));
        var (to, email) = Assert.Single(h.Email.Outreach);
        Assert.Equal("quiet@example.com", to.Email);
        Assert.Equal(OutreachSegment.NeverTranscribed, email.Segment);
        Assert.Equal("Record", Assert.Single(h.Push.Sent).Message.Data!["screen"]);
        Assert.Equal(new[] { quiet }, h.Push.Sent[0].Recipients);
    }

    [Fact]
    public async Task Admins_internal_suspended_and_unverified_accounts_without_a_device_are_left_out()
    {
        using var h = new TestHarness(Now);
        var admin = User.CreateAdmin("Admin", "admin@example.com", "hash", Now.AddDays(-30));
        h.Db.Users.Add(admin);
        var team = Account(h, "team@example.com", "Team", Now.AddDays(-30));
        h.Db.Users.Single(u => u.Id == team).SetInternal(true);
        var gone = Account(h, "gone@example.com", "Gone", Now.AddDays(-30));
        h.Db.Users.Single(u => u.Id == gone).Suspend();
        Account(h, "unverified@example.com", "Unverified", Now.AddDays(-30), verified: false);
        var appOnly = Account(h, "apponly@example.com", "App Only", Now.AddDays(-30), verified: false, device: true);
        await h.Db.SaveChangesAsync();

        Assert.Equal(1, await Run(h));
        Assert.Empty(h.Email.Outreach); // the unverified address is never mailed
        Assert.Equal(new[] { appOnly }, Assert.Single(h.Push.Sent).Recipients);
        Assert.Equal(OutreachChannel.Push, Assert.Single(h.Db.OutreachMessages).Channel);
    }

    // ── Channels and opt-out ─────────────────────────────────────────────────

    [Fact]
    public async Task Each_channel_is_used_only_when_it_reaches_them_and_the_email_opt_out_is_respected()
    {
        using var h = new TestHarness(Now);
        var emailOnly = Account(h, "email@example.com", "Email Only", Now.AddDays(-3));
        var optedOut = Account(h, "out@example.com", "Opted Out", Now.AddDays(-3), device: true);
        var optedOutNoDevice = Account(h, "gone@example.com", "Opted Out Too", Now.AddDays(-3));
        h.Db.EmailOptOuts.Add(EmailOptOut.Create(optedOut, Now.AddDays(-1)));
        h.Db.EmailOptOuts.Add(EmailOptOut.Create(optedOutNoDevice, Now.AddDays(-1)));
        await h.Db.SaveChangesAsync();

        Assert.Equal(2, await Run(h));
        Assert.Equal("email@example.com", Assert.Single(h.Email.Outreach).To.Email);
        Assert.Equal(new[] { optedOut }, Assert.Single(h.Push.Sent).Recipients);
        Assert.Empty(h.Db.OutreachMessages.Where(m => m.UserId == optedOutNoDevice));
        Assert.Equal(OutreachChannel.Email, h.Db.OutreachMessages.Single(m => m.UserId == emailOnly).Channel);
    }

    [Fact]
    public async Task The_unsubscribe_link_in_the_email_opts_the_account_out_and_a_forged_one_does_not()
    {
        using var h = new TestHarness(Now);
        var ada = Account(h, "ada@example.com", "Ada", Now.AddDays(-3));
        var bob = Account(h, "bob@example.com", "Bob", Now.AddDays(-3));
        await Run(h);

        var url = h.Email.Outreach.Single(o => o.To.Email == "ada@example.com").Email.UnsubscribeUrl;
        Assert.StartsWith("https://api.notefusion.studio/api/email/unsubscribe?token=", url);
        var token = url[(url.IndexOf("token=", StringComparison.Ordinal) + 6)..];

        var tokens = new HmacEmailUnsubscribeTokens(h.Keys);
        Assert.Equal(ada, tokens.Read(token));
        var handler = new UnsubscribeEmailCommandHandler(h.Db, h.Clock, tokens);
        Assert.True((await handler.Handle(new UnsubscribeEmailCommand(token), default)).IsSuccess);
        Assert.True((await handler.Handle(new UnsubscribeEmailCommand(token), default)).IsSuccess); // idempotent
        Assert.Equal(ada, Assert.Single(h.Db.EmailOptOuts).UserId);

        // Someone else's id with Ada's signature, garbage, and nothing at all are all refused.
        var forged = tokens.Create(bob)[..22] + token[22..];
        foreach (var bad in new[] { forged, "not-a-token", "", null })
        {
            var refused = await handler.Handle(new UnsubscribeEmailCommand(bad), default);
            Assert.Equal("EMAIL_UNSUBSCRIBE_INVALID", refused.Error.Code);
        }
        Assert.Single(h.Db.EmailOptOuts);

        // Ada is now asked nothing by email, even when she qualifies for the next segment.
        Job(h, ada, Now.AddDays(1), finished: true);
        h.Clock.UtcNow = Now.AddDays(8);
        h.Email.Outreach.Clear();
        await Run(h);
        Assert.DoesNotContain(h.Email.Outreach, o => o.To.Email == "ada@example.com");
    }

    // ── Once per segment, spacing and priority ───────────────────────────────

    [Fact]
    public async Task The_highest_segment_goes_first_the_next_waits_a_week_and_none_repeats()
    {
        using var h = new TestHarness(Now);
        var ada = Account(h, "ada@example.com", "Ada", Now.AddDays(-30));
        for (var i = 0; i < 4; i++) Job(h, ada, Now.AddDays(-5).AddHours(i), finished: true);
        Checkout(h, ada, Now.AddDays(-4));

        Assert.Equal(1, await Run(h));
        Assert.Equal(OutreachSegment.CheckoutAbandoned, Assert.Single(h.Email.Outreach).Email.Segment);

        h.Clock.UtcNow = Now.AddDays(6);
        Assert.Equal(0, await Run(h)); // inside the seven days

        h.Clock.UtcNow = Now.AddDays(7).AddHours(1);
        Assert.Equal(1, await Run(h));
        Assert.Equal(OutreachSegment.ActiveUser, h.Email.Outreach[1].Email.Segment);

        h.Clock.UtcNow = Now.AddDays(30);
        Assert.Equal(0, await Run(h)); // every segment they fit has been sent, once
        Assert.Equal(2, h.Email.Outreach.Count);
    }

    [Fact]
    public async Task A_second_send_of_the_same_message_is_refused_by_the_check_and_by_the_unique_index()
    {
        using var h = new TestHarness(Now);
        var ada = Account(h, "ada@example.com", "Ada", Now.AddDays(-3));
        var service = Service(h, On());
        var candidate = new OutreachCandidate(ada, OutreachSegment.NeverTranscribed);

        Assert.True(await service.SendAsync(candidate, default));
        Assert.False(await service.SendAsync(candidate, default));
        Assert.Single(h.Email.Outreach);

        // What an overlapping sweep's insert hits if it got past the check at the same moment.
        h.Db.OutreachMessages.Add(OutreachMessage.Claim(ada, OutreachSegment.NeverTranscribed, OutreachChannel.Email, Now));
        await Assert.ThrowsAsync<DbUpdateException>(() => h.Db.SaveChangesAsync());
    }

    // ── Hours, batch, config ─────────────────────────────────────────────────

    [Theory]
    [InlineData(7, 59, false)]  // 08:59 WAT
    [InlineData(8, 0, true)]    // 09:00 WAT
    [InlineData(17, 59, true)]  // 18:59 WAT
    [InlineData(18, 0, false)]  // 19:00 WAT
    [InlineData(23, 0, false)]  // midnight WAT
    public async Task Messages_go_out_only_between_nine_and_seven_West_Africa_Time(int utcHour, int minute, bool sends)
    {
        var at = new DateTime(2026, 10, 13, utcHour, minute, 0, DateTimeKind.Utc);
        using var h = new TestHarness(at);
        Account(h, "ada@example.com", "Ada", at.AddDays(-3));

        Assert.Equal(sends ? 1 : 0, await Run(h));
    }

    [Fact]
    public async Task A_backlog_goes_out_a_batch_at_a_time_highest_priority_first()
    {
        using var h = new TestHarness(Now);
        for (var i = 0; i < 4; i++)
            Account(h, $"never{i}@example.com", $"Never {i}", Now.AddDays(-100 + i));
        var buyer = Account(h, "buyer@example.com", "Buyer", Now.AddDays(-10));
        Checkout(h, buyer, Now.AddDays(-4));

        Assert.Equal(2, await Run(h, On(batch: 2)));
        Assert.Equal(["buyer@example.com", "never0@example.com"], h.Email.Outreach.Select(o => o.To.Email).ToList());

        h.Clock.UtcNow = Now.AddHours(1);
        Assert.Equal(2, await Run(h, On(batch: 2)));
        h.Clock.UtcNow = Now.AddHours(2);
        Assert.Equal(1, await Run(h, On(batch: 2)));
        Assert.Equal(0, await Run(h, On(batch: 2)));
        Assert.Equal(5, h.Email.Outreach.Select(o => o.To.Email).Distinct().Count());
    }

    [Fact]
    public async Task Nothing_is_sent_unless_enabled_with_a_founder_name_and_reply_to()
    {
        using var h = new TestHarness(Now);
        Account(h, "ada@example.com", "Ada", Now.AddDays(-3), device: true);

        foreach (var off in new[]
                 {
                     new OutreachSettings { FounderName = "Francis", ReplyTo = "hello@notefusion.studio" },
                     new OutreachSettings { Enabled = true, ReplyTo = "hello@notefusion.studio" },
                     new OutreachSettings { Enabled = true, FounderName = "Francis" },
                 })
        {
            Assert.False(off.IsActive);
            Assert.NotNull(off.DisabledReason);
            Assert.Equal(0, await Run(h, off));
        }

        Assert.Empty(h.Email.Sent);
        Assert.Empty(h.Push.Sent);
        Assert.Empty(h.Db.OutreachMessages);
    }

    [Fact]
    public void Settings_read_from_the_environment_treat_blank_values_as_unset()
    {
        var blank = OutreachDependencyInjection.ResolveSettings(Config(new()
        {
            ["Outreach:Enabled"] = "", ["Outreach:FounderName"] = "", ["Outreach:ReplyTo"] = "",
            ["Outreach:BatchSize"] = "", ["Outreach:IntervalMinutes"] = "", ["Outreach:ApiBaseUrl"] = "",
        }));
        Assert.False(blank.IsActive);
        Assert.Equal(50, blank.BatchSize);
        Assert.Equal(60, blank.IntervalMinutes);
        Assert.Equal(OutreachSettings.DefaultApiBaseUrl, blank.ApiBaseUrl);

        var on = OutreachDependencyInjection.ResolveSettings(Config(new()
        {
            ["Outreach:Enabled"] = "true", ["Outreach:FounderName"] = " Francis ", ["Outreach:ReplyTo"] = "hello@notefusion.studio",
            ["Outreach:BatchSize"] = "10",
        }));
        Assert.True(on.IsActive);
        Assert.Equal("Francis", on.FounderName);
        Assert.Equal(10, on.BatchSize);
    }

    // ── Failures ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_failed_email_is_recorded_and_retried_once_but_never_a_third_time()
    {
        using var h = new TestHarness(Now);
        var ada = Account(h, "ada@example.com", "Ada", Now.AddDays(-3));
        h.Email.OutreachFails = "Resend returned 500";

        Assert.Equal(1, await Run(h));
        var row = h.Db.OutreachMessages.AsNoTracking().Single();
        Assert.Equal(OutreachStatus.Failed, row.Status);
        Assert.Equal("Resend returned 500", row.Error);
        Assert.Equal(1, row.Attempts);

        h.Clock.UtcNow = Now.AddHours(1);
        Assert.Equal(1, await Run(h)); // the retry, still failing
        row = h.Db.OutreachMessages.AsNoTracking().Single();
        Assert.Equal((OutreachStatus.Failed, 2), (row.Status, row.Attempts));

        h.Email.OutreachFails = null;
        h.Clock.UtcNow = Now.AddHours(2);
        Assert.Equal(0, await Run(h));
        Assert.Equal(2, h.Email.Outreach.Count); // the first try and its one retry
        Assert.All(h.Db.OutreachMessages.AsNoTracking(), m => Assert.Equal(ada, m.UserId));
    }

    [Fact]
    public async Task A_retry_that_succeeds_is_marked_sent()
    {
        using var h = new TestHarness(Now);
        Account(h, "ada@example.com", "Ada", Now.AddDays(-3));
        h.Email.OutreachFails = "timeout";
        await Run(h);

        h.Email.OutreachFails = null;
        h.Clock.UtcNow = Now.AddHours(1);
        Assert.Equal(1, await Run(h));
        var row = h.Db.OutreachMessages.AsNoTracking().Single();
        Assert.Equal((OutreachStatus.Sent, 2, (string?)null), (row.Status, row.Attempts, row.Error));
        Assert.Equal(Now.AddHours(1), row.SentAtUtc);
    }

    [Fact]
    public async Task One_account_that_throws_does_not_stop_the_run()
    {
        using var h = new TestHarness(Now);
        Account(h, "boom@example.com", "Boom", Now.AddDays(-30));
        Account(h, "fine@example.com", "Fine", Now.AddDays(-3));
        var email = new ThrowingFor("boom@example.com", h.Email);
        var settings = On();
        var runner = new OutreachRunner(h.Db,
            new OutreachService(h.Db, h.Clock, email, h.Push, settings, new HmacEmailUnsubscribeTokens(h.Keys)),
            settings, h.Clock, NullLogger<OutreachRunner>.Instance);

        Assert.Equal(1, await runner.RunAsync(default));
        Assert.Equal("fine@example.com", Assert.Single(h.Email.Outreach).To.Email);
        // The throwing account's claim was committed before the send, so it is not tried again.
        var stuck = h.Db.OutreachMessages.AsNoTracking().Single(m => m.Status == OutreachStatus.Pending);
        Assert.Equal(h.Db.Users.Single(u => u.Email == "boom@example.com").Id, stuck.UserId);
    }

    // ── Beside the abandoned-checkout reminder ───────────────────────────────

    [Fact]
    public async Task The_outreach_waits_two_days_after_the_checkout_reminder()
    {
        using var h = new TestHarness(Now.AddDays(-1));
        var ada = Account(h, "ada@example.com", "Ada", Now.AddDays(-20));
        Checkout(h, ada, Now.AddDays(-3.5));
        Assert.Equal(1, await Remind(h)); // the reminder, at checkout + 2.5 days

        h.Clock.UtcNow = Now; // checkout 3.5 days old, reminder 1 day old
        Assert.Equal(0, await Run(h));
        h.Clock.UtcNow = Now.AddDays(1).AddMinutes(1);
        Assert.Equal(1, await Run(h));
        Assert.Equal(OutreachSegment.CheckoutAbandoned, Assert.Single(h.Email.Outreach).Email.Segment);
    }

    [Fact]
    public async Task The_checkout_reminder_holds_off_for_a_day_after_an_outreach_message()
    {
        using var h = new TestHarness(Now);
        var ada = Account(h, "ada@example.com", "Ada", Now.AddDays(-3));
        Assert.Equal(1, await Run(h)); // never transcribed

        Checkout(h, ada, Now.AddHours(1));
        h.Clock.UtcNow = Now.AddHours(4);
        Assert.Equal(0, await Remind(h));
        h.Clock.UtcNow = Now.AddDays(1).AddMinutes(1);
        Assert.Equal(1, await Remind(h));
        Assert.Single(h.Email.Sent, s => s.Kind == "checkout-abandoned");
    }

    // ── Rendering and admin ──────────────────────────────────────────────────

    [Fact]
    public void The_email_is_from_the_founder_replies_to_him_and_carries_the_unsubscribe_link_and_headers()
    {
        var unsubscribe = "https://api.notefusion.studio/api/email/unsubscribe?token=abc";
        var nameless = Template().Outreach(new EmailRecipient("x@example.com", null),
            new OutreachEmail(OutreachSegment.NeverTranscribed, "Francis", "hello@notefusion.studio", unsubscribe));

        Assert.Equal("hello@notefusion.studio", nameless.ReplyTo);
        Assert.Equal("Francis from NoteFusion", nameless.FromName);
        Assert.Equal($"<{unsubscribe}>", nameless.Headers!["List-Unsubscribe"]);
        Assert.Equal("List-Unsubscribe=One-Click", nameless.Headers["List-Unsubscribe-Post"]);
        Assert.Contains("Hi there,", nameless.HtmlBody);
        Assert.Contains("Francis from NoteFusion. You signed up", nameless.HtmlBody);
        Assert.Contains(unsubscribe, nameless.HtmlBody);
        Assert.Contains("https://notefusion.studio/app", nameless.HtmlBody);
        Assert.Contains(unsubscribe, nameless.TextBody);

        var checkout = Template().Outreach(new EmailRecipient("ada@example.com", "Ada Lovelace"),
            new OutreachEmail(OutreachSegment.CheckoutAbandoned, "Francis", "hello@notefusion.studio", unsubscribe));
        Assert.Contains("Hi Ada,", checkout.HtmlBody);
        Assert.Contains("This is Francis, I built NoteFusion.", checkout.HtmlBody);
        Assert.Contains("a month of Pro free", checkout.TextBody);
    }

    [Fact]
    public async Task The_admin_list_shows_each_send_and_a_count_per_segment()
    {
        using var h = new TestHarness(Now);
        Account(h, "ada@example.com", "Ada", Now.AddDays(-3), device: true);
        await Run(h);

        var overview = (await new GetOutreachQueryHandler(h.Db, On()).Handle(new GetOutreachQuery(), default)).Value;
        Assert.True(overview.Enabled);
        Assert.Equal(2, overview.Recent.Count);
        Assert.All(overview.Recent, r => Assert.Equal("ada@example.com", r.Email));
        var never = overview.Segments.Single(s => s.Segment == OutreachSegment.NeverTranscribed);
        Assert.Equal((1, 1, 1, 0), (never.Users, never.EmailsSent, never.PushesSent, never.Failed));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static OutreachService Service(TestHarness h, OutreachSettings settings)
        => new(h.Db, h.Clock, h.Email, h.Push, settings, new HmacEmailUnsubscribeTokens(h.Keys));

    private static Task<int> Run(TestHarness h, OutreachSettings? settings = null)
    {
        settings ??= On();
        return new OutreachRunner(h.Db, Service(h, settings), settings, h.Clock, NullLogger<OutreachRunner>.Instance)
            .RunAsync(default);
    }

    private static Task<int> Remind(TestHarness h)
        => new RemindAbandonedCheckoutsCommandHandler(h.Db, h.Clock, h.Email)
            .Handle(new RemindAbandonedCheckoutsCommand(), default)
            .ContinueWith(t => t.Result.Value);

    private static BrandedEmailTemplate Template() => new(new EmailSettings());

    private static IConfiguration Config(Dictionary<string, string?> values)
        => new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    private static Guid Account(
        TestHarness h, string email, string name, DateTime createdAt, bool verified = true, bool device = false)
    {
        var user = User.Create(name, email, "hash", createdAt);
        if (verified) h.MarkEmailVerified(user);
        h.Db.Users.Add(user);
        if (device)
            h.Db.DeviceTokens.Add(DeviceToken.Create(user.Id, $"ExponentPushToken[{user.Id:N}]", "android", 1, createdAt));
        h.Db.SaveChanges();
        return user.Id;
    }

    private static void Seen(TestHarness h, Guid userId, DateTime at)
    {
        h.Db.Users.Single(u => u.Id == userId).MarkSeen(at);
        h.Db.SaveChanges();
    }

    private static void Job(TestHarness h, Guid userId, DateTime at, bool finished)
    {
        var job = TranscriptionJob.Record($"job-{Guid.NewGuid():N}", userId, at);
        if (finished) job.Settle("{}", at.AddMinutes(1));
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
    }

    private static Plan AddPlan(TestHarness h)
    {
        var existing = h.Db.Plans.FirstOrDefault();
        if (existing is not null) return existing;
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.SaveChanges();
        return plan;
    }

    private static void MakePro(TestHarness h, Guid userId)
    {
        var plan = AddPlan(h);
        h.Db.Subscriptions.Add(Subscription.Start(userId, plan.Id, PaymentProvider.Paystack, Now.AddDays(-5), Now.AddDays(25), $"sub_{userId:N}", Now));
        h.Db.SaveChanges();
    }

    private static void Checkout(TestHarness h, Guid userId, DateTime at, Plan? plan = null, bool completed = false)
    {
        plan ??= AddPlan(h);
        var id = Guid.NewGuid().ToString("N");
        var tx = PaymentTransaction.Create(userId, plan.Id, PaymentProvider.Paystack, "idem-" + id, "ref-" + id, plan.AmountMinor, plan.Currency, at);
        tx.AttachCheckout("ps_" + id, "https://checkout.paystack.com/" + id, null, at);
        if (completed)
        {
            tx.MarkVerified("ps_" + id, null, at);
            tx.MarkCompleted(at);
        }
        else
        {
            tx.MarkFailed("Checkout session expired", at.AddMinutes(30));
        }
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
    }

    /// <summary>An email sender that breaks its never-throw contract for one address, to prove isolation.</summary>
    private sealed class ThrowingFor(string address, RecordingEmailSender inner) : IEmailSender
    {
        public Task<Result> SendOutreachAsync(EmailRecipient to, OutreachEmail email, CancellationToken ct = default)
            => to.Email == address ? throw new InvalidOperationException("boom") : inner.SendOutreachAsync(to, email, ct);

        public Task SendWelcomeAsync(EmailRecipient to, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SendPasswordChangedAsync(EmailRecipient to, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SendAccountAlreadyExistsAsync(EmailRecipient to, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SendSubscriptionReceiptAsync(EmailRecipient to, SubscriptionReceipt receipt, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SendPaymentFailedAsync(EmailRecipient to, string planName, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SendCheckoutAbandonedAsync(EmailRecipient to, string planName, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SendSubscriptionExpiringAsync(EmailRecipient to, SubscriptionExpiry expiry, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SendPasswordResetAsync(EmailRecipient to, string resetUrl, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SendEmailVerificationAsync(EmailRecipient to, string code, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SendCustomEmailAsync(EmailRecipient to, string subject, string heading, string bodyHtml, string? ctaText = null, string? ctaUrl = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SendWaitlistConfirmationAsync(EmailRecipient to, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
