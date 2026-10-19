using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A switch that changes what everyone sees, turned by an admin in the console (Operations › Feature flags): one row
/// per <see cref="Key"/>, made the first time it is changed (until then it is off). The season flags
/// (<see cref="Christmas"/>, <see cref="Halloween"/>) are the first. Every change is written to the audit log by the
/// command that makes it.
/// </summary>
/// <remarks>
/// <para>
/// <b>On for everyone</b> (<see cref="IsOn"/>) while <see cref="Enabled"/> and before <see cref="AutoOffAtUtc"/>, so a
/// season cannot be forgotten into February: past that moment it reads as off with no one touching it, and the row
/// keeps <see cref="Enabled"/> so the console can say it switched itself off.
/// </para>
/// <para>
/// <b>On for an admin</b> (<see cref="IsOnFor"/>) also while <see cref="AdminPreview"/> is on, whatever the switch and
/// the date say: the preview is how the owner sees the season on their own phone and browser before anyone else does.
/// </para>
/// </remarks>
public sealed class FeatureFlag : BaseEntity
{
    /// <summary>The Christmas season: the capped mark, snow, carols on top of Hymns, the carols path and festive pushes.</summary>
    public const string Christmas = "christmas";

    /// <summary>
    /// The Halloween season: the hatted mark, bats, songs for Halloween on top of Hymns, the Midnight path and its pushes.
    /// One season at a time: turning one on switches the other off.
    /// </summary>
    public const string Halloween = "halloween";

    public const int KeyMaxLength = 40;
    public const int EmailMaxLength = 320;

    private FeatureFlag() { } // EF Core

    /// <summary>The flag's name, lower-case: what the API routes and the clients use.</summary>
    public string Key { get; private set; } = string.Empty;

    /// <summary>The switch as an admin last set it.</summary>
    public bool Enabled { get; private set; }

    /// <summary>On for admin accounts whatever <see cref="Enabled"/> says.</summary>
    public bool AdminPreview { get; private set; }

    /// <summary>The moment the switch stops counting, or null when it stays on until an admin turns it off.</summary>
    public DateTime? AutoOffAtUtc { get; private set; }

    public Guid? UpdatedByUserId { get; private set; }

    /// <summary>Snapshot of the admin's email, as the audit log keeps it.</summary>
    public string? UpdatedByEmail { get; private set; }

    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>A flag as it stands before anyone has changed it: off, no preview, switching itself off at <paramref name="autoOffAtUtc"/>.</summary>
    public static FeatureFlag Create(string key, DateTime? autoOffAtUtc, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            Key = Guard.NotNullOrWhiteSpace(key).Trim().ToLowerInvariant(),
            AutoOffAtUtc = autoOffAtUtc,
            UpdatedAtUtc = utcNow,
        };

    /// <summary>Sets every part of the flag at once, naming who did it.</summary>
    public void Set(bool enabled, bool adminPreview, DateTime? autoOffAtUtc, Guid actorUserId, string actorEmail, DateTime utcNow)
    {
        Enabled = enabled;
        AdminPreview = adminPreview;
        AutoOffAtUtc = autoOffAtUtc;
        UpdatedByUserId = Guard.AgainstEmpty(actorUserId);
        UpdatedByEmail = Guard.NotNullOrWhiteSpace(actorEmail);
        UpdatedAtUtc = utcNow;
    }

    /// <summary>On for everyone at <paramref name="utcNow"/>: switched on, and its switch-off moment (if any) not reached.</summary>
    public bool IsOn(DateTime utcNow) => Enabled && (AutoOffAtUtc is not { } off || utcNow < off);

    /// <summary>On for this caller: for everyone, or — for an admin — while the preview is on.</summary>
    public bool IsOnFor(bool admin, DateTime utcNow) => IsOn(utcNow) || (admin && AdminPreview);

    /// <summary>Switched on, but its switch-off moment has passed: off for everyone, with no one having turned it off.</summary>
    public bool SwitchedItselfOff(DateTime utcNow) => Enabled && AutoOffAtUtc is { } off && utcNow >= off;
}
