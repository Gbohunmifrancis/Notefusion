using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// Two payments for one member fulfilled at the same moment (a webhook and the reconciliation sweep, or two
/// instances) both read the same period end. Each request has its own context, as in production; the second
/// one's save is made to happen in the gap between the first one's read and its save, which is exactly the
/// window in which the last write used to win and a paid period vanished.
/// </summary>
public sealed class ConcurrentFulfillmentTests : IDisposable
{
    private static readonly DateTime Now = new(2026, 9, 10, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime PeriodEnd = Now.AddDays(20);
    private const long Price = 499;

    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly FixedClock _clock = new(Now);
    private readonly RecordingEmailSender _email = new();

    public ConcurrentFulfillmentTests()
    {
        _connection.Open();
        using var db = Open();
        db.Database.EnsureCreated();
    }

    [Fact]
    public async Task Two_different_payments_fulfilled_at_once_both_extend_the_membership()
    {
        var (first, second) = Seed();

        // The second payment commits while the first is between reading the subscription and saving it.
        var interloper = new RunBeforeFirstSave(async () =>
        {
            await using var other = Open();
            var result = await Reconcile(other, second);
            Assert.True(result.IsSuccess);
        });

        await using (var db = Open(interloper))
        {
            var result = await Reconcile(db, first);
            Assert.True(result.IsSuccess);
        }

        Assert.True(interloper.Ran);
        await using var check = Open();
        var sub = await check.Subscriptions.SingleAsync();
        Assert.Equal(PeriodEnd.AddMonths(2), sub.CurrentPeriodEndUtc);
        Assert.Equal(2, await check.LedgerEntries.CountAsync());
        Assert.All(await check.PaymentTransactions.ToListAsync(), t => Assert.Equal(PaymentStatus.Completed, t.Status));
        Assert.Equal(2, _email.Receipts.Count);
    }

    [Fact]
    public async Task The_same_payment_fulfilled_twice_at_once_still_extends_the_membership_once()
    {
        var (first, _) = Seed();

        var interloper = new RunBeforeFirstSave(async () =>
        {
            await using var other = Open();
            Assert.True((await Reconcile(other, first)).IsSuccess);
        });

        await using (var db = Open(interloper))
        {
            // The loser of the race re-applies on the fresh row and then meets the ledger's unique index: one
            // credit per payment, so the whole second fulfilment rolls back.
            await Assert.ThrowsAnyAsync<DbUpdateException>(() => Reconcile(db, first));
        }

        await using var check = Open();
        Assert.Equal(PeriodEnd.AddMonths(1), (await check.Subscriptions.SingleAsync()).CurrentPeriodEndUtc);
        Assert.Equal(1, await check.LedgerEntries.CountAsync());
        Assert.Single(_email.Receipts);
    }

    // ---------------------------------------------------------------- fixtures

    private Task<Result> Reconcile(ApplicationDbContext db, Guid paymentId)
        => new ReconcilePaymentCommandHandler(db, new PaidFactory(), _clock, _email)
            .Handle(new ReconcilePaymentCommand(paymentId), CancellationToken.None);

    private (Guid First, Guid Second) Seed()
    {
        using var db = Open();
        var user = User.Create("Pat Payer", "pat@example.com", "hash", Now.AddDays(-40));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", Price, "USD", BillingInterval.Monthly);
        db.Users.Add(user);
        db.Plans.Add(plan);
        db.Subscriptions.Add(Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Bachs, Now.AddDays(-10), PeriodEnd, null, Now.AddDays(-10)));

        var ids = new List<Guid>();
        foreach (var reference in new[] { "NF_first", "NF_second" })
        {
            var tx = PaymentTransaction.Create(user.Id, plan.Id, PaymentProvider.Bachs, $"checkout:{reference}", reference, Price, "USD", Now.AddHours(-1));
            tx.AttachCheckout($"chk_{reference}", $"https://pay.test/{reference}", "{}", Now.AddHours(-1));
            db.PaymentTransactions.Add(tx);
            ids.Add(tx.Id);
        }

        db.SaveChanges();
        return (ids[0], ids[1]);
    }

    private ApplicationDbContext Open(params IInterceptor[] interceptors)
        => new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlite(_connection)
            .AddInterceptors(interceptors)
            .Options);

    public void Dispose() => _connection.Dispose();

    /// <summary>Runs another request to completion just before this context's first save reaches the database.</summary>
    private sealed class RunBeforeFirstSave(Func<Task> other) : SaveChangesInterceptor
    {
        public bool Ran { get; private set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!Ran)
            {
                Ran = true;
                await other();
            }

            return result;
        }
    }

    private sealed class PaidFactory : IPaymentGatewayFactory, IPaymentGateway
    {
        public PaymentProvider Provider => PaymentProvider.Bachs;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];

        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => throw new NotSupportedException();

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(new GatewayVerification(
                true, Price, "USD", request.ProviderReference ?? request.Reference, null, "{}", Terminal: true)));
    }
}
