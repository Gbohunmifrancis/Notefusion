using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Flags;

/// <summary>A flag as one caller sees it: on or not, and the last day it is on (West Africa Time) when it has one.</summary>
public sealed record FlagState(bool On, DateOnly? LastDay)
{
    public static readonly FlagState Off = new(false, null);
}

/// <summary>
/// The feature flags as the rest of the app reads them: which keys exist, whether one is on for everyone (the pushes
/// read this) or for the caller (the season endpoint and Practice read this: an admin also sees a preview), and the
/// season's calendar in West Africa Time, where the console's dates are read.
/// </summary>
/// <remarks>
/// A flag with no row has never been changed and is off. Each read is one lookup by the unique key: cheap enough for
/// every page load's <c>GET /api/app/season</c> (which is also cached by browsers and proxies for a minute).
/// </remarks>
public static class FeatureFlags
{
    /// <summary>Every flag the console lists, in its order, with the name it shows.</summary>
    public static readonly IReadOnlyList<(string Key, string Name)> Known =
    [
        (FeatureFlag.Halloween, "Halloween season"),
        (FeatureFlag.Christmas, "Christmas season"),
    ];

    /// <summary>The seasons: one is on at a time (turning one on switches the others off), Christmas first if ever two are.</summary>
    public static readonly IReadOnlyList<string> Seasons = [FeatureFlag.Christmas, FeatureFlag.Halloween];

    /// <summary>The day the Christmas season ends unless an admin picks another: 6 January, Epiphany.</summary>
    public const int SeasonEndMonth = 1;
    public const int SeasonEndDay = 6;

    /// <summary>The day the Halloween season ends unless an admin picks another: 1 November, All Saints' Day.</summary>
    public const int HalloweenEndMonth = 11;
    public const int HalloweenEndDay = 1;

    public static bool IsKnown(string? key) => Known.Any(k => string.Equals(k.Key, key, StringComparison.Ordinal));

    /// <summary>The flag's display name ("Christmas season").</summary>
    public static string NameOf(string key)
    {
        foreach (var (known, name) in Known)
            if (known == key)
                return name;
        return key;
    }

    /// <summary>Today in West Africa Time.</summary>
    public static DateOnly Today(DateTime utcNow) => DateOnly.FromDateTime(utcNow + FreeTier.WestAfricaOffset);

    /// <summary>
    /// The Christmas season's default last day, counted from <paramref name="today"/>: the next 6 January (today itself on
    /// 6 January). Turned on in December, that is the coming January's; turned on on 2 January, this one's.
    /// </summary>
    public static DateOnly DefaultLastDay(DateOnly today) => DefaultLastDay(FeatureFlag.Christmas, today);

    /// <summary>
    /// A flag's default last day, counted from <paramref name="today"/>: the next 1 November for Halloween (All Saints'
    /// Day: All Hallows' Eve is the night before), the next 6 January for Christmas and any other flag; today itself on
    /// that day.
    /// </summary>
    public static DateOnly DefaultLastDay(string key, DateOnly today)
    {
        var (month, day) = key == FeatureFlag.Halloween ? (HalloweenEndMonth, HalloweenEndDay) : (SeasonEndMonth, SeasonEndDay);
        var thisYear = new DateOnly(today.Year, month, day);
        return today <= thisYear ? thisYear : thisYear.AddYears(1);
    }

    /// <summary>
    /// The moment a season whose last day is <paramref name="lastDay"/> switches itself off: the midnight after it, West
    /// Africa Time ("switch itself off after 6 Jan" keeps 6 January Christmas everywhere the app is mostly used).
    /// </summary>
    public static DateTime SwitchOffAtUtc(DateOnly lastDay)
        => DateTime.SpecifyKind(lastDay.AddDays(1).ToDateTime(TimeOnly.MinValue) - FreeTier.WestAfricaOffset, DateTimeKind.Utc);

    /// <summary>The last day a season switching itself off at <paramref name="switchOffAtUtc"/> is on (West Africa Time).</summary>
    public static DateOnly LastDay(DateTime switchOffAtUtc)
        => DateOnly.FromDateTime(switchOffAtUtc + FreeTier.WestAfricaOffset - TimeSpan.FromTicks(1));

    /// <summary>The flag's row, or null when it has never been changed.</summary>
    public static Task<FeatureFlag?> FindAsync(IApplicationDbContext db, string key, CancellationToken ct)
        => db.FeatureFlags.AsNoTracking().FirstOrDefaultAsync(f => f.Key == key, ct);

    /// <summary>
    /// On for everyone now (the admin preview not counted): what practice reminders and "ready" pushes read, since a push
    /// reaches a phone whoever owns it.
    /// </summary>
    public static async Task<bool> IsOnForEveryoneAsync(IApplicationDbContext db, DateTime utcNow, string key, CancellationToken ct)
        => (await FindAsync(db, key, ct))?.IsOn(utcNow) == true;

    /// <summary>
    /// On for the caller now: for everyone, or, with the preview on, for a caller whose token says Admin and whose account
    /// still is one and active (a token outlives a demotion by up to its lifetime; the database has the last word).
    /// </summary>
    public static async Task<bool> IsOnForCallerAsync(
        IApplicationDbContext db, DateTime utcNow, ICurrentUser caller, string key, CancellationToken ct)
        => (await StateForCallerAsync(db, utcNow, caller, key, ct)).On;

    /// <summary>Whether the flag is on for the caller (as <see cref="IsOnForCallerAsync"/>), and its last day if it has one.</summary>
    public static async Task<FlagState> StateForCallerAsync(
        IApplicationDbContext db, DateTime utcNow, ICurrentUser caller, string key, CancellationToken ct)
    {
        var flag = await FindAsync(db, key, ct);
        if (flag is null)
            return FlagState.Off;
        var lastDay = flag.AutoOffAtUtc is { } off ? LastDay(off) : (DateOnly?)null;
        if (flag.IsOn(utcNow))
            return new FlagState(true, lastDay);
        if (!flag.AdminPreview || caller.Role != UserRole.Admin || caller.UserId is not { } userId)
            return FlagState.Off;
        var admin = await db.Users.AsNoTracking().AnyAsync(u => u.Id == userId && u.Role == UserRole.Admin && u.IsActive, ct);
        return new FlagState(flag.IsOnFor(admin, utcNow), lastDay);
    }

    /// <summary>The Christmas season, for the caller.</summary>
    public static Task<bool> ChristmasForCallerAsync(IApplicationDbContext db, DateTime utcNow, ICurrentUser caller, CancellationToken ct)
        => IsOnForCallerAsync(db, utcNow, caller, FeatureFlag.Christmas, ct);

    /// <summary>The Christmas season, for everyone.</summary>
    public static Task<bool> ChristmasForEveryoneAsync(IApplicationDbContext db, DateTime utcNow, CancellationToken ct)
        => IsOnForEveryoneAsync(db, utcNow, FeatureFlag.Christmas, ct);

    /// <summary>The season on for the caller (Christmas first, should an admin preview two), with its state; null when none is.</summary>
    public static async Task<(string Key, FlagState State)?> SeasonForCallerAsync(
        IApplicationDbContext db, DateTime utcNow, ICurrentUser caller, CancellationToken ct)
    {
        foreach (var key in Seasons)
        {
            var state = await StateForCallerAsync(db, utcNow, caller, key, ct);
            if (state.On)
                return (key, state);
        }
        return null;
    }

    /// <summary>
    /// The season on for everyone (Christmas first) and its last day, or null when none is: what the pushes dress for
    /// (a preview for admins never changes a push).
    /// </summary>
    public static async Task<(string Key, DateOnly? LastDay)?> SeasonForEveryoneAsync(IApplicationDbContext db, DateTime utcNow, CancellationToken ct)
    {
        foreach (var key in Seasons)
        {
            if (await FindAsync(db, key, ct) is { } flag && flag.IsOn(utcNow))
                return (key, flag.AutoOffAtUtc is { } off ? LastDay(off) : null);
        }
        return null;
    }
}
