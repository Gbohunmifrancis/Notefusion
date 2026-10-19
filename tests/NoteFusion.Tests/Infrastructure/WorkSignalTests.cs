using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Api.Middleware;
using NoteFusion.Application.Analytics;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Common;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Infrastructure.Transcriptions;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Infrastructure;

/// <summary>
/// The loops that work saved rows are rung as the rows are saved, instead of looking for them every few seconds, and
/// the console's live notices are told when what they show changes, instead of asking every fifteen.
/// </summary>
public class WorkSignalTests
{
    [Fact]
    public async Task A_ring_wakes_the_waiting_loop_at_once_and_is_kept_when_none_waits()
    {
        var signals = new WorkSignals();

        var waiting = signals.WaitAsync(Work.PaymentWebhooks, TimeSpan.FromMinutes(1), default);
        signals.Ring(Work.PaymentWebhooks);
        Assert.True(await waiting.WaitAsync(TimeSpan.FromSeconds(5)));

        // Rung while the loop was busy (twice): its next wait returns at once, once.
        signals.Ring(Work.PaymentAlerts);
        signals.Ring(Work.PaymentAlerts);
        Assert.True(await signals.WaitAsync(Work.PaymentAlerts, TimeSpan.FromSeconds(5), default));
        Assert.False(await signals.WaitAsync(Work.PaymentAlerts, TimeSpan.FromMilliseconds(50), default));

        // Another loop's bell is its own.
        Assert.False(await signals.WaitAsync(Work.BlogDrafts, TimeSpan.FromMilliseconds(50), default));
    }

    [Fact]
    public async Task Saving_a_webhook_rings_its_worker_and_a_new_account_tells_the_live_notices()
    {
        using var h = new TestHarness();
        var signals = new WorkSignals();
        var events = new InMemoryJobEvents();
        using var console = events.Watch(AdminLiveFeed.Key, "user:admin")!;
        await using var db = Context(h, signals, events);

        db.WebhookEvents.Add(WebhookEvent.Receive(PaymentProvider.Paystack, "evt-1", "charge.success", "ref-1", "{}", h.Clock.UtcNow));
        await db.SaveChangesAsync();

        Assert.True(await signals.WaitAsync(Work.PaymentWebhooks, TimeSpan.FromSeconds(1), default));
        Assert.False(console.Events.TryRead(out _));

        db.Users.Add(User.Create("Ada Obi", "ada@example.com", "hash", h.Clock.UtcNow));
        db.SaveChanges();

        Assert.True(console.Events.TryRead(out var told));
        Assert.Equal(AdminLiveFeed.Changed, told.Name);
        Assert.False(await signals.WaitAsync(Work.PaymentWebhooks, TimeSpan.FromMilliseconds(50), default));
    }

    [Fact]
    public async Task An_edit_rings_nothing_and_a_save_that_fails_rings_nothing()
    {
        using var h = new TestHarness();
        var signals = new WorkSignals();
        var events = new InMemoryJobEvents();
        using var console = events.Watch(AdminLiveFeed.Key, "user:admin")!;
        await using var db = Context(h, signals, events);
        var user = User.Create("Ada Obi", "ada@example.com", "hash", h.Clock.UtcNow);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        console.Events.TryRead(out _);

        user.RecordSuccessfulLogin(h.Clock.UtcNow);
        await db.SaveChangesAsync();
        Assert.False(console.Events.TryRead(out _));

        // The same webhook twice: the unique index refuses the second, and nobody is woken for it.
        db.WebhookEvents.Add(WebhookEvent.Receive(PaymentProvider.Paystack, "evt-1", "charge.success", "ref-1", "{}", h.Clock.UtcNow));
        await db.SaveChangesAsync();
        await signals.WaitAsync(Work.PaymentWebhooks, TimeSpan.FromSeconds(1), default);
        db.ChangeTracker.Clear();
        db.WebhookEvents.Add(WebhookEvent.Receive(PaymentProvider.Paystack, "evt-1", "charge.success", "ref-1", "{}", h.Clock.UtcNow));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.False(await signals.WaitAsync(Work.PaymentWebhooks, TimeSpan.FromMilliseconds(50), default));
    }

    [Fact]
    public async Task A_batch_of_drafts_tells_the_console_as_it_moves_and_rings_its_worker_once()
    {
        using var h = new TestHarness();
        var signals = new WorkSignals();
        var events = new InMemoryJobEvents();
        using var console = events.Watch(AdminLiveFeed.Key, "user:admin")!;
        await using var db = Context(h, signals, events);
        string Told() => console.Events.TryRead(out var told) ? told.Name : "nothing";

        var run = BlogGenerationRun.Queue(BlogGenerationTrigger.Admin, 2, null, null, null, h.Clock.UtcNow);
        db.BlogGenerationRuns.Add(run);
        await db.SaveChangesAsync();
        Assert.Equal(AdminLiveFeed.Blog, Told());
        Assert.True(await signals.WaitAsync(Work.BlogDrafts, TimeSpan.FromSeconds(1), default));

        run.Start("gemini-flash-latest", h.Clock.UtcNow);
        await db.SaveChangesAsync();
        Assert.Equal(AdminLiveFeed.Blog, Told());

        run.Add(new BlogGenerationItem("hymn-tips", "hymn tips", null, Guid.NewGuid(), "Hymn tips", true, [], null, []));
        await db.SaveChangesAsync();
        Assert.Equal(AdminLiveFeed.Blog, Told());

        // Saving nothing new about it says nothing, and only queueing a batch wakes the worker.
        await db.SaveChangesAsync();
        Assert.Equal("nothing", Told());
        Assert.False(await signals.WaitAsync(Work.BlogDrafts, TimeSpan.FromMilliseconds(50), default));
    }

    [Fact]
    public async Task Someone_coming_online_tells_the_live_notices_once()
    {
        using var h = new TestHarness();
        var user = User.Create("Ada Obi", $"{Guid.NewGuid():N}@example.com", "hash", h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        var events = new InMemoryJobEvents();
        using var console = events.Watch(AdminLiveFeed.Key, "user:admin")!;
        var seen = new LastSeenMiddleware(_ => Task.CompletedTask);
        Task Request() => seen.InvokeAsync(new DefaultHttpContext(), new StubCurrentUser(user.Id), h.Db, h.Clock, events,
            NullLogger<LastSeenMiddleware>.Instance);

        await Request();
        Assert.True(console.Events.TryRead(out _));

        // Still here a couple of minutes later: written again, but not news.
        h.Clock.UtcNow += TimeSpan.FromMinutes(2);
        await Request();
        Assert.False(console.Events.TryRead(out _));

        // Back after the online window: news again.
        h.Clock.UtcNow += LastSeen.OnlineWindow + TimeSpan.FromMinutes(1);
        await Request();
        Assert.True(console.Events.TryRead(out _));
    }

    private static ApplicationDbContext Context(TestHarness h, WorkSignals signals, IJobEvents events)
        => new(new DbContextOptionsBuilder<ApplicationDbContext>(h.Options)
            .AddInterceptors(new WorkSignalInterceptor(signals, events))
            .Options);
}
