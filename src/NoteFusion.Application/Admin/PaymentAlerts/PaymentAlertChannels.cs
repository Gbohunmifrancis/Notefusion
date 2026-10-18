using NoteFusion.Application.Practice;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Admin.PaymentAlerts;

/// <summary>
/// Where a payment alert rings on one admin phone: its Android channel, its iOS sound and its category. Mirrored by
/// mobile <c>lib/paymentAlerts.ts</c>, which creates exactly these channels; keep the two in step.
/// </summary>
/// <remarks>
/// A channel's sound and vibration are fixed once Android has created it, so every choice in Payment alerts is a
/// channel of its own and the server picks one per phone. The ids carry a version: a new sound means a new id.
/// Quiet hours and "Mute 1 hour" use the silent, still channel, which every phone with alerts keeps.
/// </remarks>
public static class PaymentAlertChannels
{
    /// <summary>The chime with the two-pulse vibration: the default.</summary>
    public const string Main = "payments-v1";

    /// <summary>No sound, no vibration: the banner only (quiet hours, a mute, or both switched off).</summary>
    public const string Quiet = "payments-v1-none-still";

    /// <summary>The admins' payment-problem alerts (paid with no Pro, stuck checkouts), apart from the payments.</summary>
    public const string Problems = "payment-problems";

    /// <summary>The category the app registers with "View payment" and "Mute 1 hour".</summary>
    public const string Category = "payment";

    /// <summary>The bundled chime's file name, which iOS plays as the push's sound.</summary>
    public const string ChimeFile = "payment.wav";

    /// <summary>How long Expo may hold an alert for a phone that is off: a payment an hour late is still news.</summary>
    public const int TimeToLiveSeconds = 3600;

    /// <summary>Quiet hours on the account's own clock: from 22:00 until 07:00.</summary>
    public const int QuietFromHour = 22;
    public const int QuietUntilHour = 7;

    public static string ChannelFor(string sound, bool vibrate)
        => sound == PaymentAlertSounds.Chime && vibrate
            ? Main
            : $"payments-v1-{sound}{(vibrate ? "" : "-still")}";

    public static string? IosSound(string sound) => sound switch
    {
        PaymentAlertSounds.Chime => ChimeFile,
        PaymentAlertSounds.Phone => "default",
        _ => null,
    };

    /// <summary>Whether <paramref name="utcNow"/> is in the quiet hours of <paramref name="timeZone"/> (null: Lagos).</summary>
    public static bool IsQuietHour(DateTime utcNow, string? timeZone)
    {
        var hour = TimeZoneInfo.ConvertTimeFromUtc(utcNow, PracticeTime.Resolve(timeZone)).Hour;
        return hour >= QuietFromHour || hour < QuietUntilHour;
    }

    /// <summary>
    /// The channel and iOS sound for one phone now: its own choice, or silent and still while it is muted or (with
    /// quiet at night on) in the quiet hours.
    /// </summary>
    public static (string Channel, string? Sound) For(
        string sound, bool vibrate, bool quietAtNight, DateTime? mutedUntilUtc, string? timeZone, DateTime utcNow)
    {
        var hushed = (mutedUntilUtc is { } until && until > utcNow) || (quietAtNight && IsQuietHour(utcNow, timeZone));
        return hushed ? (Quiet, null) : (ChannelFor(sound, vibrate), IosSound(sound));
    }
}
