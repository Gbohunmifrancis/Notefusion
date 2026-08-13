using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The payment state machine is the safety rail around real money: it must forbid skipping steps
/// (fulfilling a payment the provider never confirmed) and must tolerate replays (a webhook delivered
/// twice), because getting either wrong means a customer is charged wrong or served for free.
/// </summary>
public class PaymentTransactionTests
{
    private static readonly DateTime Now = new(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Guid User = Guid.NewGuid();
    private static readonly Guid PlanId = Guid.NewGuid();

    private static PaymentTransaction NewPending() => PaymentTransaction.Create(
        User, PlanId, PaymentProvider.Squad, "idem-1", "ref-1", 999, "usd", Now);

    [Fact]
    public void Create_starts_pending_and_uppercases_currency()
    {
        var tx = NewPending();

        Assert.Equal(PaymentStatus.Pending, tx.Status);
        Assert.Equal("USD", tx.Currency);
        Assert.False(tx.IsTerminal);
    }

    [Fact]
    public void Rejects_a_non_positive_amount()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => PaymentTransaction.Create(
            User, PlanId, PaymentProvider.Squad, "idem", "ref", 0, "USD", Now));
    }

    [Fact]
    public void Walks_the_full_lifecycle_pending_to_completed()
    {
        var tx = NewPending();

        tx.AttachCheckout("prov-ref", "https://checkout.example/abc", "{}", Now);
        Assert.Equal(PaymentStatus.Processing, tx.Status);
        Assert.Equal("https://checkout.example/abc", tx.CheckoutUrl);

        tx.MarkVerified("prov-ref", "{\"status\":\"success\"}", Now);
        Assert.Equal(PaymentStatus.Verified, tx.Status);

        tx.MarkCompleted(Now);
        Assert.Equal(PaymentStatus.Completed, tx.Status);
        Assert.True(tx.IsTerminal);
    }

    [Fact]
    public void Cannot_complete_a_payment_the_provider_never_verified()
    {
        var tx = NewPending();
        tx.AttachCheckout(null, "https://checkout.example/abc", null, Now);

        // Processing -> Completed skips Verified: the money was never confirmed.
        Assert.Throws<InvalidOperationException>(() => tx.MarkCompleted(Now));
    }

    [Fact]
    public void Cannot_verify_before_a_checkout_is_attached()
    {
        var tx = NewPending();

        Assert.Throws<InvalidOperationException>(() => tx.MarkVerified("prov-ref", null, Now));
    }

    [Fact]
    public void Verification_is_idempotent_so_a_replayed_webhook_is_a_no_op()
    {
        var tx = NewPending();
        tx.AttachCheckout(null, "https://checkout.example/abc", null, Now);
        tx.MarkVerified("prov-ref", null, Now);
        tx.MarkCompleted(Now);

        // A duplicate webhook re-verifies an already-completed payment: must not throw or regress.
        tx.MarkVerified("prov-ref", null, Now);
        Assert.Equal(PaymentStatus.Completed, tx.Status);

        // And completing twice is harmless.
        tx.MarkCompleted(Now);
        Assert.Equal(PaymentStatus.Completed, tx.Status);
    }

    [Fact]
    public void A_verified_payment_cannot_be_marked_failed()
    {
        var tx = NewPending();
        tx.AttachCheckout(null, "https://checkout.example/abc", null, Now);
        tx.MarkVerified("prov-ref", null, Now);

        // The money is already taken; failing it silently would strand a paid customer.
        Assert.Throws<InvalidOperationException>(() => tx.MarkFailed("gateway said no", Now));
    }

    [Fact]
    public void Failing_is_legal_before_the_money_moves_and_is_idempotent()
    {
        var tx = NewPending();
        tx.AttachCheckout(null, "https://checkout.example/abc", null, Now);

        tx.MarkFailed("abandoned", Now);
        Assert.Equal(PaymentStatus.Failed, tx.Status);
        Assert.Equal("abandoned", tx.FailureReason);

        tx.MarkFailed("abandoned again", Now); // no-op, keeps the first reason
        Assert.Equal(PaymentStatus.Failed, tx.Status);
        Assert.Equal("abandoned", tx.FailureReason);
    }
}
