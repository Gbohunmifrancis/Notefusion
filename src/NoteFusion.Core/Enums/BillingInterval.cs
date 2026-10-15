namespace NoteFusion.Core.Enums;

/// <summary>How often a plan recurs. Drives the length of each subscription period.</summary>
public enum BillingInterval
{
    Monthly = 1,
    Yearly = 2,

    /// <summary>
    /// Bought once, never renews. Not an interval at all, but it lives here because it is the same
    /// decision — how far a payment extends access — and every consumer already switches on this enum.
    /// A lifetime plan is charged as a one-off, so it has no provider-side subscription to renew.
    /// </summary>
    Lifetime = 3,

    /// <summary>
    /// One transcription, bought once: no period and no membership. Not an interval either, and kept here
    /// for the same reason <see cref="Lifetime"/> is — every consumer switches on this enum, so a plan that
    /// buys something other than Pro time has to be a value they are forced to meet, not a flag they can
    /// overlook. <c>BillingPeriod.Advance</c> throws on it: fulfilment records a credit instead
    /// (<c>PaymentFulfillment</c>), and nothing may ever turn it into days of Pro.
    /// </summary>
    Single = 4
}
