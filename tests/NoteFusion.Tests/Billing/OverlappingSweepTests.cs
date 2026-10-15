using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// Two instances (or one slow sweep and the next) working the same row. Each sweep decides "this one is due"
/// from what it read, so both can decide it; only the conditional "mark as sent" decides who sends. Here the
/// second sweep runs to completion in the gap between the first one's read and its mark — the overlap that
/// used to mail the customer twice — and exactly one message goes out.
/// </summary>
public sealed class OverlappingSweepTests : IDisposable
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly FixedClock _clock = new(Now);
    private readonly RecordingEmailSender _email = new();
    private readonly RecordingPushSender _push = new();

    public OverlappingSweepTests()
    {
        _connection.Open();
        using var db = Open();
        db.Database.EnsureCreated();
    }

    [Fact]
    public async Task Two_overlapping_expiry_sweeps_warn_once()
    {
        var subscriptionId = SeedExpiring();
        var other = new RunBeforeFirstUpdate(async () =>
        {
            await using var db = Open();
            Assert.True((await Notify(db, subscriptionId)).IsSuccess);
        });

        await using (var db = Open(other))
            Assert.True((await Notify(db, subscriptionId)).IsSuccess);

        Assert.True(other.Ran);
        Assert.Single(_email.Sent, s => s.Kind == "subscription-expiring");
        Assert.Single(_push.Sent);
    }

    [Fact]
    public async Task Two_overlapping_checkout_reminder_sweeps_remind_once()
    {
        SeedAbandonedCheckout();
        var sentBySecond = -1;
        var other = new RunBeforeFirstUpdate(async () =>
        {
            await using var db = Open();
            sentBySecond = (await Remind(db)).Value;
        });

        int sentByFirst;
        await using (var db = Open(other))
            sentByFirst = (await Remind(db)).Value;

        Assert.True(other.Ran);
        Assert.Equal(1, sentBySecond);
        Assert.Equal(0, sentByFirst);
        Assert.Single(_email.Sent, s => s.Kind == "checkout-abandoned");
    }

    // ---------------------------------------------------------------- fixtures

    private Task<NoteFusion.Shared.Results.Result> Notify(ApplicationDbContext db, Guid subscriptionId)
        => new NotifySubscriptionExpiringCommandHandler(db, _clock, _email, _push)
            .Handle(new NotifySubscriptionExpiringCommand(subscriptionId), CancellationToken.None);

    private Task<NoteFusion.Shared.Results.Result<int>> Remind(ApplicationDbContext db)
        => new RemindAbandonedCheckoutsCommandHandler(db, _clock, _email)
            .Handle(new RemindAbandonedCheckoutsCommand(), CancellationToken.None);

    private Guid SeedExpiring()
    {
        using var db = Open();
        var user = User.Create("Pat Pro", "pat@example.com", "hash", Now.AddDays(-60));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
        var sub = Subscription.Start(user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-25), Now.AddDays(5), null, Now.AddDays(-25));
        db.Users.Add(user);
        db.Plans.Add(plan);
        db.Subscriptions.Add(sub);
        db.SaveChanges();
        return sub.Id;
    }

    private void SeedAbandonedCheckout()
    {
        using var db = Open();
        var user = User.Create("Ada", "ada@example.com", "hash", Now.AddDays(-1));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly);
        var at = Now.AddHours(-3);
        var tx = PaymentTransaction.Create(user.Id, plan.Id, PaymentProvider.Paystack, "idem-1", "ref-1", plan.AmountMinor, plan.Currency, at);
        tx.AttachCheckout("ps_1", "https://checkout.paystack.com/1", null, at);
        tx.MarkFailed("Checkout session expired", at.AddMinutes(30));
        db.Users.Add(user);
        db.Plans.Add(plan);
        db.PaymentTransactions.Add(tx);
        db.SaveChanges();
    }

    private ApplicationDbContext Open(params IInterceptor[] interceptors)
        => new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlite(_connection)
            .AddInterceptors(interceptors)
            .Options);

    public void Dispose() => _connection.Dispose();

    /// <summary>Runs another sweep to completion just before this context's first UPDATE reaches the database.</summary>
    private sealed class RunBeforeFirstUpdate(Func<Task> other) : DbCommandInterceptor
    {
        public bool Ran { get; private set; }

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (!Ran && command.CommandText.TrimStart().StartsWith("UPDATE", StringComparison.OrdinalIgnoreCase))
            {
                Ran = true;
                await other();
            }

            return result;
        }
    }
}
