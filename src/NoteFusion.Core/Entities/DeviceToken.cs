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
