using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The webhook inbox turns at-least-once delivery from providers into exactly-once processing. A
/// failed attempt must stay retryable until a cap, then park itself for reconciliation rather than
/// spinning forever.
/// </summary>
public class WebhookEventTests
{
    private static readonly DateTime Now = new(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);

    private static WebhookEvent Received() => WebhookEvent.Receive(
        PaymentProvider.Squad, "evt-1", "charge.success", "ref-1", "{\"a\":1}", Now);

    [Fact]
    public void Received_events_start_unprocessed()
    {
        var e = Received();

        Assert.Equal(WebhookStatus.Received, e.Status);
        Assert.Equal(0, e.ProcessAttempts);
        Assert.Null(e.ProcessedAtUtc);
    }

    [Fact]
    public void Processing_marks_it_done_and_clears_the_error()
    {
        var e = Received();
        e.RecordFailure("transient", maxAttempts: 5, Now);

        e.MarkProcessed(Now);

        Assert.Equal(WebhookStatus.Processed, e.Status);
        Assert.NotNull(e.ProcessedAtUtc);
        Assert.Null(e.LastError);
    }

    [Fact]
    public void Stays_retryable_until_attempts_are_exhausted_then_parks_as_failed()
    {
        var e = Received();

        e.RecordFailure("boom", maxAttempts: 3, Now);
        Assert.Equal(WebhookStatus.Received, e.Status);
        e.RecordFailure("boom", maxAttempts: 3, Now);
        Assert.Equal(WebhookStatus.Received, e.Status);

        e.RecordFailure("boom", maxAttempts: 3, Now);
        Assert.Equal(WebhookStatus.Failed, e.Status);
        Assert.Equal(3, e.ProcessAttempts);
        Assert.Equal("boom", e.LastError);
    }
}
