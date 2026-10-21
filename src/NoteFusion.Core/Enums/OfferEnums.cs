namespace NoteFusion.Core.Enums;

/// <summary>
/// Who an offer email was queued for, decided when the admin pressed Send (stored by name). Also the order the queue
/// goes out in while the quota is tight: lapsed Pro first, then free accounts, then current Pro members.
/// </summary>
public enum OfferEmailGroup
{
    /// <summary>Had Pro once; it has ended.</summary>
    Lapsed = 0,

    /// <summary>Has never had Pro.</summary>
    Free = 1,

    /// <summary>Pro now, billed on the web: could add a period at the offer price.</summary>
    ProNow = 2,
}

/// <summary>Where one queued offer email stands (stored by name).</summary>
public enum OfferEmailStatus
{
    /// <summary>Waiting for the person's sending hours and room in the quota.</summary>
    Queued = 0,

    /// <summary>The provider took it.</summary>
    Sent = 1,

    /// <summary>Not sent, and never will be: <see cref="OfferSkipReason"/> says why.</summary>
    Skipped = 2,

    /// <summary>Tried twice and refused both times; the last error is kept.</summary>
    Failed = 3,
}

/// <summary>Why a queued offer email was dropped at send time (stored by name).</summary>
public enum OfferSkipReason
{
    /// <summary>Turned email from us off (<c>EmailOptOut</c>) after the queue was made.</summary>
    OptedOut = 0,

    /// <summary>Already paid at the offer price.</summary>
    Bought = 1,

    /// <summary>A free or lapsed account that became Pro another way before its turn.</summary>
    BecamePro = 2,

    /// <summary>The offer ended where the person is (or for everyone) before their turn came.</summary>
    Ended = 3,

    /// <summary>Suspended, unverified, or no longer on dollar prices.</summary>
    NoLongerEligible = 4,
}
