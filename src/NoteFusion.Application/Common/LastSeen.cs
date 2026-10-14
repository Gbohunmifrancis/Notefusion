namespace NoteFusion.Application.Common;

/// <summary>
/// The rules for "online" and "last seen", in one place so the users table, its filter and the
/// middleware that records presence agree.
/// </summary>
public static class LastSeen
{
    /// <summary>Seen within this long counts as online now.</summary>
    public static readonly TimeSpan OnlineWindow = TimeSpan.FromMinutes(5);

    /// <summary>How often a busy account's stamp is rewritten; finer than this is noise.</summary>
    public static readonly TimeSpan WriteEvery = TimeSpan.FromMinutes(1);

    /// <summary>The filter values the users table offers.</summary>
    public const string Online = "online", Today = "today", Week = "week", Month = "month", Inactive = "inactive";
}
