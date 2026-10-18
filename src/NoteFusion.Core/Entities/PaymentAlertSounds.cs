namespace NoteFusion.Core.Entities;

/// <summary>
/// What a payment alert sounds like on an admin's phone (<see cref="DeviceToken.PaymentAlertSound"/>). Each is its own
/// Android channel, because a channel's sound is fixed once the phone has created it.
/// </summary>
public static class PaymentAlertSounds
{
    /// <summary>NoteFusion's cash chime, <c>payment.wav</c> in the app.</summary>
    public const string Chime = "chime";

    /// <summary>The phone's own notification sound.</summary>
    public const string Phone = "phone";

    /// <summary>The banner and the vibration only.</summary>
    public const string None = "none";

    public static bool IsKnown(string? value) => value is Chime or Phone or None;
}
