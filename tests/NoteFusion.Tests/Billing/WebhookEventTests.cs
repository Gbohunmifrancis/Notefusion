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

    [Fact]
    public void A_fresh_event_is_due_at_once()
        => Assert.True(Received().IsDueForRetry(Now));

    [Theory]
    // attempts so far, wait after the last one
    [InlineData(1, 5)]
    [InlineData(2, 30)]
    [InlineData(3, 120)]
    [InlineData(4, 600)]
    [InlineData(5, 1800)]
    // The last step repeats rather than running off the end of the schedule.
    [InlineData(7, 1800)]
    public void A_failed_event_waits_out_a_growing_delay_before_its_next_attempt(int attempts, int delaySeconds)
    {
        // Retries used to land every poll, so a fifteen-second provider outage was enough to park a
        // payment's webhook for good.
        var e = Received();
        for (var i = 0; i < attempts; i++)
            e.RecordFailure("boom", maxAttempts: 8, Now);

        Assert.False(e.IsDueForRetry(Now.AddSeconds(delaySeconds - 1)));
        Assert.True(e.IsDueForRetry(Now.AddSeconds(delaySeconds)));
    }

    [Fact]
    public void A_long_error_is_clipped_to_the_column()
    {
        var e = Received();

        e.RecordFailure(new string('x', 5000), maxAttempts: 8, Now);

        Assert.Equal(1000, e.LastError!.Length);
    }
}
