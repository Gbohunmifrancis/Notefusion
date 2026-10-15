using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>The console's cash-register alert reads the payments that just went through, and only those.</summary>
public class LivePaymentsTests
{
    private static readonly DateTime Now = new(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_payment_that_just_went_through_is_live_with_who_paid_how_much_and_for_what()
    {
        using var h = new TestHarness(Now);
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        var ada = User.Create("Ada Obi", "ada@example.com", "hash", Now.AddDays(-3));
        h.Db.Users.Add(ada);
        h.Db.SaveChanges();

        Pay(h, ada.Id, plan, Now.AddMinutes(-2), PaymentStatus.Completed);
        Pay(h, ada.Id, plan, Now.AddMinutes(-1), PaymentStatus.Pending);
        Pay(h, ada.Id, plan, Now.AddMinutes(-3), PaymentStatus.Failed);
        Pay(h, ada.Id, plan, Now.AddMinutes(-30), PaymentStatus.Completed); // old news

        var live = (await new GetLiveActivityQueryHandler(h.Db, h.Clock).Handle(new GetLiveActivityQuery(), default)).Value;

        var paid = Assert.Single(live.Payments);
        Assert.Equal(("Ada Obi", "ada@example.com", 750_000L, "NGN", "NoteFusion Pro (Monthly)"),
            (paid.FullName, paid.Email, paid.AmountMinor, paid.Currency, paid.PlanName));
    }

    private static void Pay(TestHarness h, Guid userId, Plan plan, DateTime at, PaymentStatus status)
    {
        var id = Guid.NewGuid().ToString("N");
        var tx = PaymentTransaction.Create(userId, plan.Id, PaymentProvider.Paystack, "idem-" + id, "ref-" + id,
            plan.AmountMinor, plan.Currency, at.AddMinutes(-1));
        tx.AttachCheckout("ps_" + id, "https://checkout.paystack.com/" + id, null, at.AddMinutes(-1));
        if (status == PaymentStatus.Completed)
        {
            tx.MarkVerified("ps_" + id, null, at);
            tx.MarkCompleted(at);
        }
        else if (status == PaymentStatus.Failed)
        {
            tx.MarkFailed("Declined", at);
        }
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
    }
}
