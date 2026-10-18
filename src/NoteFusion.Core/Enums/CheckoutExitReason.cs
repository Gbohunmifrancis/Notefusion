namespace NoteFusion.Core.Enums;

/// <summary>
/// The one-tap answer to "What stopped you?" after someone came back from a payment page without paying. Stored by
/// name; camelCase on the wire (<c>"cardDeclined"</c>).
/// </summary>
public enum CheckoutExitReason
{
    /// <summary>"The price wasn't in my currency" (offered on dollar checkouts only).</summary>
    Currency = 0,

    /// <summary>"My card was declined".</summary>
    CardDeclined = 1,

    /// <summary>"The page was slow or didn't load".</summary>
    Slow = 2,

    /// <summary>"It costs too much".</summary>
    TooExpensive = 3,

    /// <summary>"I'm just looking".</summary>
    JustLooking = 4,

    /// <summary>"Something else", with a short note.</summary>
    SomethingElse = 5
}
