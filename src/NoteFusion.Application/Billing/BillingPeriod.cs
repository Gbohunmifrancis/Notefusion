using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Billing;

/// <summary>
/// The one place that decides what "a month of Pro" means. Both paths that open or extend a period read
/// it from here — a verified payment (<see cref="PaymentFulfillment"/>) and an operator granting a comp —
/// so a gifted month is exactly as long as a paid one.
/// </summary>
internal static class BillingPeriod
{
    /// <summary>
    /// How far one period extends access. Written as a switch over every interval rather than a two-way
    /// ternary because the ternary's "else" quietly meant "a year", so adding
    /// <see cref="BillingInterval.Lifetime"/> would have granted a lifetime buyer twelve months and looked
    /// correct until the renewal that never came. The default throws instead of guessing: a period we
    /// cannot compute is a bug to fix, not a length to invent.
    /// </summary>
    public static DateTime Advance(DateTime from, BillingInterval interval) => interval switch
    {
        BillingInterval.Monthly => from.AddMonths(1),
        BillingInterval.Yearly => from.AddYears(1),
        BillingInterval.Lifetime => Subscription.LifetimeEndUtc,
        _ => throw new ArgumentOutOfRangeException(nameof(interval), interval, "Unhandled billing interval."),
    };
}
