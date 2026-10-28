using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A registered push device (expo push token) for a user. Push notifications for
/// transcription completion are delivered to all of a user's active devices (PRD §push).
/// </summary>
public class DeviceToken : BaseEntity
{
    private DeviceToken() { } // EF Core

    public Guid UserId { get; private set; }
    public string Token { get; private set; } = string.Empty;
    public string Platform { get; private set; } = "ios"; // "ios" | "android" | "web"
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }

    /// <summary>
    /// Which app build this device was last seen running. Reported on every registration, which
    /// happens at each sign-in, so it tracks the device rather than going stale after an update.
    /// </summary>
    /// <remarks>
    /// Zero means "registered before the client started reporting it". Treated as behind, because
    /// that is what such a row almost certainly is.
    /// </remarks>
    public int AppBuild { get; private set; }

    /// <summary>
    /// The newest build this device has already been told about. What makes the update notice
    /// once-per-version rather than once-per-sweep.
    /// </summary>
    public int NotifiedBuild { get; private set; }

    /// <summary>
    /// Whether the app code this device last registered with takes its practice reminders from the server. Only
    /// these devices are sent them: older code schedules reminders of its own on the phone, and would show both.
    /// </summary>
    /// <remarks>
    /// Not derivable from <see cref="AppBuild"/>: that is the native build, and the code that understands server
    /// reminders reaches phones as an over-the-air update, which leaves the native build number as it was. So the
    /// code says so itself when it registers (<c>serverReminders: true</c>), and a device still on older code
    /// re-registering (which does not send it) turns it back off.
    /// </remarks>
    public bool ServerReminders { get; private set; }

    // ── Payment alerts (an admin's phone; board f-admin/09) ─────────────────────────────────────────────────────
    // Set from Admin › Payment alerts on the phone itself (PUT /api/admin/alerts/device). Read only for a device whose
    // account is an Admin in the database at send time, so on a customer's row they are inert.

    /// <summary>"Alert me when someone pays". Off until the phone's own admin says otherwise.</summary>
    public bool PaymentAlerts { get; private set; }

    /// <summary><see cref="PaymentAlertSounds"/>: our cash chime, the phone's own sound, or none.</summary>
    public string PaymentAlertSound { get; private set; } = PaymentAlertSounds.Chime;

    /// <summary>The two short pulses.</summary>
    public bool PaymentAlertVibrate { get; private set; } = true;

    /// <summary>22:00–07:00 on the account's clock: banners, no sound.</summary>
    public bool PaymentAlertQuietAtNight { get; private set; }

    /// <summary>Amount and plan only; who paid is one tap away in Admin.</summary>
    public bool PaymentAlertHideNames { get; private set; }

    /// <summary>"Payment problems too": paid with no Pro, stuck checkouts. On by default, as it always was.</summary>
    public bool PaymentProblemAlerts { get; private set; } = true;

    /// <summary>"Mute 1 hour": until then the alerts still show, without a sound.</summary>
    public DateTime? PaymentAlertsMutedUntilUtc { get; private set; }

    /// <summary>
    /// When this phone last said how it wants payment alerts. Set only by app code that has created the payment
    /// channels, so the server names those channels to this device and to no other.
    /// </summary>
    public DateTime? PaymentAlertsSetAtUtc { get; private set; }

    /// <summary>
    /// Which payment channels this phone's code made: 1 (<c>payments-v1-…</c>) or 2 (<c>payments-v2-…</c>, the chime kept
    /// in the build). Said by the code with every setting it sends, as <see cref="ServerReminders"/> is: not derivable
    /// from <see cref="AppBuild"/>, which EAS numbers for every build made, released or not; a phone on older code
    /// sending its settings (without it) goes back to 1.
    /// </summary>
    public int PaymentChannelVersion { get; private set; } = 1;

    public void SetPaymentAlerts(
        bool on, string sound, bool vibrate, bool quietAtNight, bool hideNames, bool problems, DateTime utcNow,
        int channelVersion = 1)
    {
        PaymentAlerts = on;
        if (!PaymentAlertSounds.IsKnown(sound))
            throw new ArgumentException($"Unknown payment alert sound '{sound}'.", nameof(sound));
        PaymentAlertSound = sound;
        PaymentAlertVibrate = vibrate;
        PaymentAlertQuietAtNight = quietAtNight;
        PaymentAlertHideNames = hideNames;
        PaymentProblemAlerts = problems;
        PaymentAlertsSetAtUtc = utcNow;
        PaymentChannelVersion = channelVersion;
    }

    /// <summary>Silences the alerts until <paramref name="untilUtc"/>; null (or a moment passed) unmutes.</summary>
    public void MutePaymentAlerts(DateTime? untilUtc, DateTime utcNow)
        => PaymentAlertsMutedUntilUtc = untilUtc is { } until && until > utcNow ? until : null;

    public static DeviceToken Create(
        Guid userId, string token, string platform, int appBuild, DateTime utcNow, bool serverReminders = false)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            Token = Guard.NotNullOrWhiteSpace(token),
            Platform = Guard.NotNullOrWhiteSpace(platform),
            AppBuild = appBuild,
            ServerReminders = serverReminders,
            CreatedAt = utcNow,
            UpdatedAt = utcNow
        };

    /// <summary>
    /// Records the build this device is now running, and that we have just heard from it.
    /// Supersedes the old bare <c>Touch</c>: every path that refreshes a registration now knows the
    /// build, so there is no longer a caller that wants one without the other.
    /// </summary>
    /// <remarks>
    /// A device that has updated is no longer behind, so <see cref="NotifiedBuild"/> is left alone —
    /// it only has to stop the notice for a given release repeating, and the next release moves past
    /// it regardless.
    /// </remarks>
    public void ReportBuild(int appBuild, DateTime utcNow, bool serverReminders = false)
    {
        AppBuild = appBuild;
        ServerReminders = serverReminders;
        UpdatedAt = utcNow;
    }

    /// <summary>
    /// Claims the update notice for <paramref name="build"/>, returning <c>false</c> when this device
    /// has already had it. The claim is what the caller commits before sending, so a redelivery
    /// cannot turn into a second notification.
    /// </summary>
    public bool MarkUpdateNoticeSent(int build, DateTime utcNow)
    {
        if (NotifiedBuild >= build)
            return false;

        NotifiedBuild = build;
        UpdatedAt = utcNow;
        return true;
    }
}
