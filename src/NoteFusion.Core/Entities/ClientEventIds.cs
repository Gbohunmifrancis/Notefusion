using System.Text.RegularExpressions;

namespace NoteFusion.Core.Entities;

/// <summary>
/// The id a phone or a browser gives each event it sends (<see cref="AppEvent.ClientId"/>, <see cref="WebEvent.ClientId"/>):
/// a client that is not sure a batch arrived sends it again, and an event whose id is already stored is not stored twice.
/// </summary>
public static partial class ClientEventIds
{
    public const int MaxLength = 40;

    /// <summary>The id when it is 8 to 40 letters, digits, dashes or underscores; null otherwise (and then no dedup).</summary>
    public static string? Clean(string? id)
    {
        id = id?.Trim();
        return id is not null && Pattern().IsMatch(id) ? id : null;
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{8,40}$")]
    private static partial Regex Pattern();
}
