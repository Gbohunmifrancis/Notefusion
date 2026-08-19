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
    Lifetime = 3
}
