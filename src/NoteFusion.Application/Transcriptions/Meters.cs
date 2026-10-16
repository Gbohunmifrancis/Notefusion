namespace NoteFusion.Application.Transcriptions;

/// <summary>
/// The time signatures a submit may name: the one list the API checks, and the one the web and mobile
/// "Beats in a bar" choice offers (web <c>assets/app.js</c> and <c>assets/preview.js</c>, mobile
/// <c>src/lib/meter.ts</c>). The worker parses any N/D (<c>server/app/api/routes.py</c>) and writes 4/4
/// unless it is told the meter; these are the meters a person can name without counting a score, and
/// anything else here is a typo or a script, refused before a free transcription is spent on it.
/// </summary>
public static class Meters
{
    public static readonly IReadOnlyList<string> Supported = ["2/4", "3/4", "4/4", "6/8"];

    /// <summary>
    /// Reads a submitted time signature. Nothing (null, blank or "auto", the old clients' default) is
    /// <c>true</c> with a null <paramref name="meter"/>: the worker's own choice. A supported meter is
    /// <c>true</c> with that meter; anything else is <c>false</c>.
    /// </summary>
    public static bool TryRead(string? value, out string? meter)
    {
        meter = null;
        var given = value?.Trim();
        if (string.IsNullOrEmpty(given) || given.Equals("auto", StringComparison.OrdinalIgnoreCase))
            return true;
        if (!Supported.Contains(given))
            return false;
        meter = given;
        return true;
    }
}
