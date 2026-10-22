using System.Text.RegularExpressions;
using NoteFusion.Core.Seedwork;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One thing the phone app did, first-party: today, Listen from anywhere (a take started, refused, reminded or ended, the
/// floating button hidden, a setting changed), logged by the native service with no JS running and sent by the app with
/// the account's token. The admin console's Listen from anywhere page reads these rows back.
/// </summary>
/// <remarks>
/// A name and flat <c>key=value;…</c> details: where it came from, how long, why it ended. Never audio, words, names or
/// addresses. Always an account's (the route needs a token); deleted with the account and after
/// <see cref="TranscriptionLog.RetentionDays"/> days, as the website's events are.
/// </remarks>
public partial class AppEvent : BaseEntity
{
    public const int NameMaxLength = 60;
    public const int DetailMaxLength = 300;
    public const int DeviceHashMaxLength = 64;

    /// <summary>A phone holds its log for as long as it goes unopened; past this the events are no longer worth counting.</summary>
    public static readonly TimeSpan MaxAge = TimeSpan.FromDays(30);

    /// <summary>The phone's clock may run ahead; past this an event is stamped "now".</summary>
    public static readonly TimeSpan MaxAhead = TimeSpan.FromMinutes(10);

    private AppEvent() { } // EF Core

    public Guid UserId { get; private set; }

    /// <summary>Lower-case words and underscores (<c>listen_take_end</c>).</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Flat <c>key=value;…</c> pairs; null when the event carries none.</summary>
    public string? Detail { get; private set; }

    /// <summary>The phone's device id, as the same one-way hash the trial ledger uses; null when it sent none.</summary>
    public string? DeviceHash { get; private set; }

    /// <summary>The installed native build (EAS's versionCode), 0 when unknown.</summary>
    public int AppBuild { get; private set; }

    /// <summary>When it happened, by the phone's clock, kept within <see cref="MaxAge"/> and <see cref="MaxAhead"/>.</summary>
    public DateTime OccurredAtUtc { get; private set; }

    public DateTime ReceivedAtUtc { get; private set; }

    /// <summary>The phone's own id for the event (<see cref="ClientEventIds"/>): a batch sent twice is stored once.</summary>
    public string? ClientId { get; private set; }

    /// <summary>
    /// An event from what the phone sent, or null when it is not worth keeping: a name that is not lower-case words and
    /// underscores, or an event older than <see cref="MaxAge"/>. Every string is cut to its column and control characters
    /// are dropped, so a hostile payload cannot fail the batch.
    /// </summary>
    public static AppEvent? TryCreate(
        Guid userId, string? name, string? detail, DateTime? occurredAtUtc, string? deviceHash, int appBuild, DateTime nowUtc,
        string? clientId = null)
    {
        name = name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > NameMaxLength || !NamePattern().IsMatch(name))
            return null;

        var at = occurredAtUtc is { } t ? DateTime.SpecifyKind(t.ToUniversalTime(), DateTimeKind.Utc) : nowUtc;
        if (at < nowUtc - MaxAge)
            return null;
        if (at > nowUtc + MaxAhead)
            at = nowUtc;

        return new AppEvent
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = name,
            Detail = Clean(detail, DetailMaxLength),
            DeviceHash = Clean(deviceHash, DeviceHashMaxLength),
            AppBuild = Math.Clamp(appBuild, 0, 1_000_000),
            OccurredAtUtc = at,
            ReceivedAtUtc = nowUtc,
            ClientId = ClientEventIds.Clean(clientId),
        };
    }

    /// <summary>The detail's pairs as a dictionary (later keys win); empty for none.</summary>
    public static IReadOnlyDictionary<string, string> ParseDetail(string? detail)
    {
        var pairs = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(detail))
            return pairs;
        foreach (var part in detail.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var eq = part.IndexOf('=');
            if (eq <= 0)
                continue;
            pairs[part[..eq].Trim()] = part[(eq + 1)..].Trim();
        }
        return pairs;
    }

    private static string? Clean(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        var kept = new string(value.Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (kept.Length == 0)
            return null;
        return kept.Length <= max ? kept : kept[..max];
    }

    [GeneratedRegex("^[a-z][a-z0-9_]*$")]
    private static partial Regex NamePattern();
}
