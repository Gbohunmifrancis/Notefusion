namespace NoteFusion.Core.Enums;

/// <summary>Lifecycle of a user's Pro subscription.</summary>
public enum SubscriptionStatus
{
    /// <summary>Paid and within the current period.</summary>
    Active = 1,

    /// <summary>A renewal charge failed; access continues through a grace window before expiry.</summary>
    PastDue = 2,

    /// <summary>User cancelled; stays usable until the current period ends, then expires.</summary>
    Canceled = 3,

    /// <summary>Period ended without renewal; Pro access is revoked.</summary>
    Expired = 4
}
