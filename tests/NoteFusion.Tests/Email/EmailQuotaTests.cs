using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Outreach;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Infrastructure.Outreach;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Email;

/// <summary>
/// The sending quota: the email plan caps mail per day (and week, and month), and the mail an account cannot work
/// without must never find the cap used up. Optional mail stops at a share of each window, counting every kind;
/// essential mail always goes; a held batch email is not claimed, so a later run sends it, once.
/// </summary>
public class EmailQuotaTests
{
    /// <summary>11:00 WAT, inside outreach sending hours.</summary>
    private static readonly DateTime Now = new(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc);

    /// <summary>Sixty sends that leave the 24-hour window ten minutes from <see cref="Now"/>: the default day's optional share.</summary>
    private static readonly DateTime LeavesTheDaySoon = Now - TimeSpan.FromHours(24) + TimeSpan.FromMinutes(10);

    private static readonly EmailRecipient Ada = new("ada@example.com", "Ada");

    // ── The window maths ─────────────────────────────────────────────────────

    [Theory]
    [InlineData(100, 0.6, 60)]
    [InlineData(3000, 0.6, 1800)]
    [InlineData(100, 0.29, 29)] // 100 * 0.29 is 28.999999999999996 in a double
    [InlineData(7, 0.5, 3)] // rounded down: optional mail never takes the essential share's last place
    [InlineData(100, 0, 0)]
    [InlineData(100, 1, 100)]
    [InlineData(100, 1.5, 100)]
    public void The_optional_ceiling_is_the_share_of_the_limit_rounded_down(int limit, double share, int ceiling)
        => Assert.Equal(ceiling, EmailBudget.OptionalCeiling(limit, share));

    [Fact]
    public void Optional_mail_stops_at_the_ceiling_not_one_after_it()
    {
        Assert.True(EmailBudget.AllowsOptional(59, 100, 0.6));
        Assert.False(EmailBudget.AllowsOptional(60, 100, 0.6));
        Assert.False(EmailBudget.AllowsOptional(0, 100, 0));
    }

    [Fact]
    public void Only_capped_windows_are_counted_shortest_first()
    {
        Assert.Equal(
            new[] { ("day", 100), ("month", 3000) },
            EmailBudget.Windows(new EmailQuotaSettings()).Select(w => (w.Name, w.Limit)));

        var all = EmailBudget.Windows(new EmailQuotaSettings { WeeklyLimit = 500 });
        Assert.Equal(new[] { "day", "week", "month" }, all.Select(w => w.Name));
        Assert.Equal(new[] { TimeSpan.FromHours(24), TimeSpan.FromDays(7), TimeSpan.FromDays(31) }, all.Select(w => w.Length));

        Assert.Empty(EmailBudget.Windows(new EmailQuotaSettings { DailyLimit = null, MonthlyLimit = 0 }));
    }

    [Fact]
    public void Only_the_mail_an_account_can_do_without_is_optional()
    {
        Assert.Equal(
            new[] { EmailKind.Welcome, EmailKind.WaitlistConfirmation, EmailKind.CheckoutReminder, EmailKind.TranscriptionTips, EmailKind.Outreach, EmailKind.Offer },
            Enum.GetValues<EmailKind>().Where(EmailBudget.IsOptional));
    }

    [Fact]
    public void Settings_from_the_environment_keep_the_defaults_for_blanks_and_turn_a_window_off_at_zero()
    {
        var blank = Resolve(("Email:DailyLimit", ""), ("Email:WeeklyLimit", ""), ("Email:MonthlyLimit", ""), ("Email:OptionalShare", ""));
        Assert.Equal(100, blank.DailyLimit);
        Assert.Null(blank.WeeklyLimit);
        Assert.Equal(3000, blank.MonthlyLimit);
        Assert.Equal(0.6, blank.OptionalShare);

        var set = Resolve(("Email:DailyLimit", "0"), ("Email:WeeklyLimit", " 400 "), ("Email:MonthlyLimit", "50000"), ("Email:OptionalShare", "0.5"));
        Assert.Null(set.DailyLimit);
        Assert.Equal(400, set.WeeklyLimit);
        Assert.Equal(50000, set.MonthlyLimit);
        Assert.Equal(0.5, set.OptionalShare);

        var nonsense = Resolve(("Email:DailyLimit", "lots"), ("Email:OptionalShare", "1.5"));
        Assert.Equal(100, nonsense.DailyLimit);
        Assert.Equal(0.6, nonsense.OptionalShare);
    }

    [Fact]
    public async Task A_send_exactly_a_window_ago_has_left_that_window()
    {
        using var h = new TestHarness(Now);
        var quota = Quota(h, new EmailQuotaSettings { DailyLimit = 100, WeeklyLimit = 100, MonthlyLimit = 100 });
        var ms = TimeSpan.FromMilliseconds(1);
        foreach (var length in new[] { EmailBudget.Day, EmailBudget.Week, EmailBudget.Month })
        {
            Sends(h, 1, Now - length); // out of this window, in the longer ones
            Sends(h, 1, Now - length + ms); // still in it
        }

        var usage = await quota.ReadUsageAsync(default);

        Assert.Equal(new[] { ("day", 1), ("week", 3), ("month", 5) }, usage.Select(u => (u.Window, u.Sent)));
    }

    [Fact]
    public async Task The_day_holds_optional_mail_at_its_share_counting_every_kind_and_says_so_once()
    {
        using var h = new TestHarness(Now);
        var log = new CapturingLogger<EmailQuota>();
        var quota = Quota(h, log: log);

        Sends(h, 59, Now.AddHours(-1), EmailKind.Verification);
        Assert.True(await quota.AllowsOptionalAsync(EmailKind.Welcome, default));
        Assert.Empty(log.Lines);

        Sends(h, 1, Now.AddHours(-1), EmailKind.Receipt);
        Assert.False(await quota.AllowsOptionalAsync(EmailKind.Welcome, default));

        var line = Assert.Single(log.Lines);
        Assert.Contains("Welcome", line, StringComparison.Ordinal);
        Assert.Contains("day window at 60/100", line, StringComparison.Ordinal);
        Assert.DoesNotContain("@", line, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_week_and_the_month_hold_on_their_own_when_the_day_has_room()
    {
        using var h = new TestHarness(Now);
        // Ceilings: 60 a day, 12 a week, 30 a month.
        var quota = Quota(h, new EmailQuotaSettings { DailyLimit = 100, WeeklyLimit = 20, MonthlyLimit = 50 });

        Sends(h, 12, Now.AddDays(-3));
        Assert.False(await quota.AllowsOptionalAsync(EmailKind.Outreach, default));

        // Four days on, those have left the week; the month has 12 of its 30.
        h.Clock.UtcNow = Now.AddDays(4).AddMinutes(1);
        Assert.True(await quota.AllowsOptionalAsync(EmailKind.Outreach, default));

        Sends(h, 18, Now.AddDays(-10));
        Assert.False(await quota.AllowsOptionalAsync(EmailKind.Outreach, default));
    }

    // ── The sender ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Essential_mail_sends_past_the_share_and_the_cap_and_is_counted()
    {
        using var h = new TestHarness(Now);
        Sends(h, 100, Now.AddHours(-1)); // the whole day used
        var (sender, transport) = Sender(h);

        await sender.SendEmailVerificationAsync(Ada, "123456");
        await sender.SendPasswordResetAsync(Ada, "https://notefusion.studio/reset?token=t");
        await sender.SendSubscriptionReceiptAsync(Ada, new SubscriptionReceipt("NoteFusion Pro", 499, "USD", null, "ref-1"));
        await sender.SendPasswordChangedAsync(Ada);

        Assert.Equal(4, transport.Sent.Count);
        Assert.Equal(
            new[] { EmailKind.Verification, EmailKind.PasswordReset, EmailKind.PasswordChanged, EmailKind.Receipt },
            h.Db.EmailSends.AsNoTracking().Where(s => s.SentAtUtc == Now).Select(s => s.Kind).AsEnumerable().Order());
    }

    [Fact]
    public async Task Optional_mail_is_held_at_the_share_and_sent_once_the_window_allows()
    {
        using var h = new TestHarness(Now);
        Sends(h, 60, LeavesTheDaySoon);
        var (sender, transport) = Sender(h);

        await sender.SendWelcomeAsync(Ada);
        await sender.SendWaitlistConfirmationAsync(Ada);
        var outreach = await sender.SendOutreachAsync(Ada, Note());

        Assert.Empty(transport.Sent);
        Assert.True(EmailBudget.IsHeld(outreach.Error));
        Assert.Equal(60, h.Db.EmailSends.Count()); // a held email is not counted as sent

        h.Clock.UtcNow = Now.AddMinutes(15);
        await sender.SendWelcomeAsync(Ada);
        Assert.True((await sender.SendOutreachAsync(Ada, Note())).IsSuccess);

        Assert.Equal(2, transport.Sent.Count);
        Assert.Equal(1, h.Db.EmailSends.Count(s => s.Kind == EmailKind.Welcome));
        Assert.Equal(1, h.Db.EmailSends.Count(s => s.Kind == EmailKind.Outreach));
    }

    [Fact]
    public async Task A_send_the_provider_refuses_is_not_counted()
    {
        using var h = new TestHarness(Now);
        var (sender, transport) = Sender(h);
        transport.Fails = true;

        await sender.SendEmailVerificationAsync(Ada, "123456");
        var outreach = await sender.SendOutreachAsync(Ada, Note());

        Assert.True(outreach.IsFailure);
        Assert.Empty(h.Db.EmailSends);
    }

    // ── The batches: held means unclaimed, sent later, never twice ───────────

    [Fact]
    public async Task Held_failed_transcription_tips_are_not_claimed_and_go_once_on_a_later_sweep()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Ada Lovelace", "ada@example.com", "hash", Now.AddDays(-3));
        h.Db.Users.Add(user);
        var job = TranscriptionJob.Record("job-1", user.Id, Now.AddHours(-1));
        job.Settle(null, Now.AddMinutes(-50));
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
        Sends(h, 60, LeavesTheDaySoon);

        Assert.Equal(0, await Tips(h));
        Assert.Empty(h.Email.Sent);
        Assert.Null(h.Db.Users.AsNoTracking().Single().FailedTranscriptionEmailSentAtUtc);

        h.Clock.UtcNow = Now.AddMinutes(15);
        Assert.Equal(1, await Tips(h));
        h.Clock.UtcNow = Now.AddMinutes(20);
        Assert.Equal(0, await Tips(h));
        Assert.Equal("transcription-failed", Assert.Single(h.Email.Sent).Kind);
    }

    [Fact]
    public async Task A_held_checkout_reminder_is_not_claimed_and_goes_once_on_a_later_sweep()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Ada Lovelace", "ada@example.com", "hash", Now.AddDays(-10));
        h.Db.Users.Add(user);
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        var tx = PaymentTransaction.Create(user.Id, plan.Id, PaymentProvider.Paystack, "idem-1", "ref-1", 750_000, "NGN", Now.AddHours(-5));
        tx.AttachCheckout("ps_1", "https://checkout.paystack.com/1", null, Now.AddHours(-5));
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
        Sends(h, 60, LeavesTheDaySoon);

        Assert.Equal(0, await Remind(h));
        Assert.Null(h.Db.Users.AsNoTracking().Single().CheckoutReminderSentAtUtc);

        h.Clock.UtcNow = Now.AddMinutes(15);
        Assert.Equal(1, await Remind(h));
        h.Clock.UtcNow = Now.AddMinutes(25);
        Assert.Equal(0, await Remind(h));
        Assert.Equal("checkout-abandoned", Assert.Single(h.Email.Sent).Kind);
    }

    [Fact]
    public async Task Held_outreach_claims_nothing_for_email_lets_a_push_only_account_through_and_writes_later_once()
    {
        using var h = new TestHarness(Now);
        var ada = Account(h, "ada@example.com", verified: true, device: true); // email and push
        var bo = Account(h, "bo@example.com", verified: false, device: true); // push only
        Sends(h, 60, LeavesTheDaySoon);

        Assert.Equal(1, await Outreach(h));
        Assert.Empty(h.Email.Outreach);
        var pushed = Assert.Single(h.Db.OutreachMessages.AsNoTracking());
        Assert.Equal((bo, OutreachChannel.Push), (pushed.UserId, pushed.Channel));

        // Room again: Ada's note goes on both channels, as one message.
        h.Clock.UtcNow = Now.AddMinutes(15);
        Assert.Equal(1, await Outreach(h));
        Assert.Equal("ada@example.com", Assert.Single(h.Email.Outreach).To.Email);
        Assert.Equal(2, h.Db.OutreachMessages.Count(m => m.UserId == ada && m.Status == OutreachStatus.Sent));

        h.Clock.UtcNow = Now.AddHours(1);
        Assert.Equal(0, await Outreach(h));
        Assert.Single(h.Email.Outreach);
    }

    [Fact]
    public async Task Outreach_held_by_the_sender_after_its_claim_is_not_a_spent_try()
    {
        using var h = new TestHarness(Now);
        Account(h, "ada@example.com", verified: true, device: false);

        // The quota filled between the run's check and the send: the sender holds it.
        h.Email.OutreachError = EmailBudget.Held;
        await Outreach(h, Quota(h));
        var held = h.Db.OutreachMessages.AsNoTracking().Single();
        Assert.Equal((OutreachStatus.Failed, 0), (held.Status, held.Attempts));

        h.Email.OutreachError = null;
        h.Clock.UtcNow = Now.AddHours(1);
        Assert.Equal(1, await Outreach(h, Quota(h)));
        var sent = h.Db.OutreachMessages.AsNoTracking().Single();
        Assert.Equal((OutreachStatus.Sent, 1), (sent.Status, sent.Attempts));
    }

    [Fact]
    public async Task An_outreach_retry_waits_unclaimed_while_email_is_held()
    {
        using var h = new TestHarness(Now);
        Account(h, "ada@example.com", verified: true, device: false);
        h.Email.OutreachFails = "Resend returned 500"; // a real failed try
        await Outreach(h);
        h.Email.OutreachFails = null;

        h.Clock.UtcNow = Now.AddHours(1);
        Sends(h, 60, h.Clock.UtcNow - TimeSpan.FromHours(24) + TimeSpan.FromMinutes(10));
        Assert.Equal(0, await Outreach(h));
        var waiting = h.Db.OutreachMessages.AsNoTracking().Single();
        Assert.Equal((OutreachStatus.Failed, 1), (waiting.Status, waiting.Attempts));

        h.Clock.UtcNow = Now.AddHours(1).AddMinutes(15);
        Assert.Equal(1, await Outreach(h));
        Assert.Equal(OutreachStatus.Sent, h.Db.OutreachMessages.AsNoTracking().Single().Status);
        Assert.Equal(2, h.Email.Outreach.Count); // the failed try and the retry; nothing more
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────

    private static EmailQuota Quota(TestHarness h, EmailQuotaSettings? settings = null, ILogger<EmailQuota>? log = null)
        => new(h.Db, h.Options, settings ?? new EmailQuotaSettings(), h.Clock, log ?? NullLogger<EmailQuota>.Instance);

    private static void Sends(TestHarness h, int count, DateTime at, EmailKind kind = EmailKind.Verification)
    {
        h.Db.EmailSends.AddRange(Enumerable.Range(0, count).Select(_ => EmailSend.Record(kind, at)));
        h.Db.SaveChanges();
    }

    private static (EmailSender Sender, RecordingTransport Transport) Sender(TestHarness h)
    {
        var transport = new RecordingTransport();
        var sender = new EmailSender(
            new BrandedEmailTemplate(new EmailSettings()), transport, NullLogger<EmailSender>.Instance, Quota(h));
        return (sender, transport);
    }

    private static OutreachEmail Note()
        => new(OutreachSegment.NeverTranscribed, "Francis", "hello@notefusion.studio", "https://api.notefusion.studio/api/email/unsubscribe?token=t");

    private static async Task<int> Tips(TestHarness h)
        => (await new EmailFailedTranscriptionTipsCommandHandler(h.Db, h.Clock, h.Email, quota: Quota(h))
            .Handle(new EmailFailedTranscriptionTipsCommand(), default)).Value;

    private static async Task<int> Remind(TestHarness h)
        => (await new RemindAbandonedCheckoutsCommandHandler(h.Db, h.Clock, h.Email, quota: Quota(h))
            .Handle(new RemindAbandonedCheckoutsCommand(), default)).Value;

    /// <summary>One outreach run, as the worker makes it: a fresh service (one scope per run) on the quota.</summary>
    private static Task<int> Outreach(TestHarness h, IEmailQuota? quota = null)
    {
        var settings = new OutreachSettings { Enabled = true, FounderName = "Francis", ReplyTo = "hello@notefusion.studio" };
        var service = new OutreachService(
            h.Db, h.Clock, h.Email, h.Push, settings, new HmacEmailUnsubscribeTokens(h.Keys), quota: quota ?? Quota(h));
        return new OutreachRunner(h.Db, service, settings, h.Clock, NullLogger<OutreachRunner>.Instance).RunAsync(default);
    }

    /// <summary>An account three days past sign-up with no transcription: due the first outreach note.</summary>
    private static Guid Account(TestHarness h, string email, bool verified, bool device)
    {
        var user = User.Create("Ada Lovelace", email, "hash", Now.AddDays(-3));
        if (verified) h.MarkEmailVerified(user);
        h.Db.Users.Add(user);
        if (device)
            h.Db.DeviceTokens.Add(DeviceToken.Create(user.Id, $"ExponentPushToken[{user.Id:N}]", "android", 1, Now.AddDays(-3)));
        h.Db.SaveChanges();
        return user.Id;
    }

    private static EmailQuotaSettings Resolve(params (string Key, string Value)[] pairs)
        => EmailSettings.ResolveQuota(new ConfigurationBuilder()
            .AddInMemoryCollection(pairs.ToDictionary(p => p.Key, p => (string?)p.Value))
            .Build());

    private sealed class RecordingTransport : IEmailTransport
    {
        public List<EmailMessage> Sent { get; } = [];
        public bool Fails { get; set; }

        public Task SendAsync(EmailMessage message, CancellationToken ct)
        {
            if (Fails)
                throw new EmailDeliveryException("Resend returned 422 (UnprocessableEntity).");
            Sent.Add(message);
            return Task.CompletedTask;
        }
    }

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<string> Lines { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Lines.Add(formatter(state, exception));
    }
}
