using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// The email after a failed transcription: once a day at most, only about a recent failure nobody has
/// already tried again after, never to a suspended account, and saying the attempt cost nothing.
/// </summary>
public class FailedTranscriptionEmailTests
{
    private static readonly DateTime Now = new(2026, 10, 15, 9, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_failure_is_emailed_once_after_the_quiet_period()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Job(h, user, Now, failed: true);

        // Not straight away: they may be trying again this minute.
        Assert.Equal(0, await Run(h));

        h.Clock.UtcNow = Now + EmailFailedTranscriptionTipsCommand.QuietFor + TimeSpan.FromMinutes(1);
        Assert.Equal(1, await Run(h));
        var sent = Assert.Single(h.Email.Sent);
        Assert.Equal(("transcription-failed", "ada@example.com"), (sent.Kind, sent.To.Email));

        // The next sweep, and the one after: nothing more about the same failure.
        h.Clock.UtcNow += TimeSpan.FromMinutes(5);
        Assert.Equal(0, await Run(h));
        Assert.Single(h.Email.Sent);
    }

    [Fact]
    public async Task At_most_one_a_day_however_many_fail()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Job(h, user, Now, failed: true);
        h.Clock.UtcNow = Now.AddMinutes(15);
        await Run(h);

        // Another failure two hours later: still today's email.
        Job(h, user, Now.AddHours(2), failed: true);
        h.Clock.UtcNow = Now.AddHours(3);
        Assert.Equal(0, await Run(h));

        // A failure the next day is news again.
        Job(h, user, Now.AddHours(26), failed: true);
        h.Clock.UtcNow = Now.AddHours(27);
        Assert.Equal(1, await Run(h));
        Assert.Equal(2, h.Email.Sent.Count);
    }

    [Fact]
    public async Task Nobody_hears_about_a_failure_they_already_tried_again_after_or_a_success()
    {
        using var h = new TestHarness(Now);
        var retried = Seed(h, "retried@example.com");
        Job(h, retried, Now, failed: true);
        Job(h, retried, Now.AddMinutes(3), failed: false); // went back and it worked
        var fine = Seed(h, "fine@example.com");
        Job(h, fine, Now, failed: false);

        h.Clock.UtcNow = Now.AddHours(1);
        Assert.Equal(0, await Run(h));
        Assert.Empty(h.Email.Sent);
    }

    [Fact]
    public async Task Suspended_accounts_and_old_failures_are_left_alone()
    {
        using var h = new TestHarness(Now);
        var suspended = Seed(h, "gone@example.com");
        h.Db.Users.Single(u => u.Id == suspended.Id).Suspend();
        Job(h, suspended, Now, failed: true);
        var old = Seed(h, "old@example.com");
        Job(h, old, Now.AddDays(-2), failed: true);
        h.Db.SaveChanges();

        h.Clock.UtcNow = Now.AddHours(1);
        Assert.Equal(0, await Run(h));
    }

    [Fact]
    public async Task A_pro_account_is_told_its_allowance_is_untouched()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-3), Now.AddDays(27), "s-1", Now.AddDays(-3)));
        Job(h, user, Now, failed: true);

        h.Clock.UtcNow = Now.AddHours(1);
        await Run(h);
        Assert.Equal("transcription-failed-pro", Assert.Single(h.Email.Sent).Kind);
    }

    [Fact]
    public void The_email_says_it_was_free_gives_three_tips_and_links_back_to_the_app()
    {
        var template = new BrandedEmailTemplate(new EmailSettings { AppUrl = "https://notefusion.studio" });

        var free = template.TranscriptionFailed(new EmailRecipient("ada@example.com", "Ada"), onPro: false);
        Assert.Contains("count against your free tries", free.HtmlBody, StringComparison.Ordinal);
        Assert.Equal(3, free.HtmlBody.Split("<li").Length - 1);
        Assert.Contains("https://notefusion.studio/app", free.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("two minutes", free.TextBody, StringComparison.Ordinal);
        Assert.Contains("https://notefusion.studio/app", free.TextBody, StringComparison.Ordinal);

        var pro = template.TranscriptionFailed(new EmailRecipient("ada@example.com", "Ada"), onPro: true);
        Assert.DoesNotContain("free tries", pro.HtmlBody, StringComparison.Ordinal);
    }

    private static async Task<int> Run(TestHarness h)
        => (await new EmailFailedTranscriptionTipsCommandHandler(h.Db, h.Clock, h.Email)
            .Handle(new EmailFailedTranscriptionTipsCommand(), default)).Value;

    private static User Seed(TestHarness h, string email = "ada@example.com")
    {
        var user = User.Create("Ada Lovelace", email, "hash", Now.AddDays(-3));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    /// <summary>A job started at <paramref name="at"/> that settled a minute later, failed or finished.</summary>
    private static void Job(TestHarness h, User user, DateTime at, bool failed)
    {
        var job = TranscriptionJob.Record("job-" + Guid.NewGuid().ToString("N"), user.Id, at);
        job.Settle(failed ? null : "{}", at.AddMinutes(1));
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
    }
}
