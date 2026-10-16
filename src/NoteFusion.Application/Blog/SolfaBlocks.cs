using System.Text.RegularExpressions;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Blog;

/// <summary>
/// The ```solfa blocks in a post's Markdown, checked the way the site's build renders them
/// (<c>tools/blog/lib/grid-html.mjs</c>, <c>renderSolfaBlock</c>): a block is a few <c>field: value</c> lines naming
/// a published hymn (and optionally its bars, a key to move it to, words off) or a scale. The solfa itself is
/// never in the post: the build writes it with the engine. A block the build could not render would stop
/// the post, so publishing refuses it here first. Keys are read by the C# engine's <see cref="KeyParser"/>,
/// the mirror of the web engine's <c>parseKey</c>.
/// </summary>
public static partial class SolfaBlocks
{
    private static readonly HashSet<string> Known = ["hymn", "bars", "key", "words", "scale", "harmonic", "caption"];

    /// <summary>The source of every ```solfa block in the Markdown, in order.</summary>
    public static IReadOnlyList<string> Find(string markdown)
        => Block().Matches(markdown ?? string.Empty).Select(m => m.Groups["src"].Value).ToList();

    /// <summary>The hymns the blocks cite (what the post page lists under "Hymns in this post").</summary>
    public static IReadOnlyList<string> HymnsCited(string markdown)
        => Find(markdown).Select(Parse).Where(f => f.Fields is not null && f.Fields.TryGetValue("hymn", out _))
            .Select(f => f.Fields!["hymn"]).Distinct(StringComparer.Ordinal).ToList();

    /// <summary>
    /// What is wrong with one block, as the build would say it, or null when it renders. With no catalogue
    /// (the site could not be read) only the block's own form is checked, not the hymn or its bars.
    /// </summary>
    public static string? Problem(string source, BlogCatalogue? catalogue)
    {
        var (fields, error) = Parse(source);
        if (error is not null)
            return error;
        var spec = fields!;
        var unknown = spec.Keys.FirstOrDefault(k => !Known.Contains(k));
        if (unknown is not null)
            return $"solfa block: unknown field \"{unknown}\"";

        if (spec.TryGetValue("scale", out var scale) && Truthy(scale))
        {
            var key = KeyParser.Parse(scale);
            if (key.IsFailure)
                return $"not a key: \"{scale}\"";
            if (spec.TryGetValue("harmonic", out var harmonic) && Truthy(harmonic) && key.Value.Mode != KeyMode.Minor)
                return "only a minor key has a harmonic minor scale";
            return null;
        }

        if (!spec.TryGetValue("hymn", out var slug) || !Truthy(slug))
            return "solfa block: give a `hymn:` or a `scale:`";
        if (spec.TryGetValue("key", out var to) && Truthy(to) && KeyParser.Parse(to).IsFailure)
            return $"cannot transpose to \"{to}\": not a key";

        int? first = null, last = null;
        if (spec.TryGetValue("bars", out var bars))
        {
            var m = BarRange().Match(bars);
            if (!m.Success)
                return "solfa block: bars must look like 1-4";
            first = int.Parse(m.Groups[1].Value);
            last = int.Parse(m.Groups[2].Value);
        }

        if (catalogue is null)
            return null;
        var hymn = catalogue.Hymn(slug);
        if (hymn is null)
            return $"solfa block: no published hymn \"{slug}\"";
        if (first is { } a && last is { } b && (a < 1 || b < a || b > hymn.Bars))
            return $"solfa block: {hymn.Title} has bars 1-{hymn.Bars}";
        return null;
    }

    /// <summary>
    /// A block's fields. The build reads it as YAML; posts only ever use flat <c>name: value</c> lines, so this
    /// reads those (comments after " #", quotes) and refuses anything else rather than guess.
    /// </summary>
    internal static (Dictionary<string, string>? Fields, string? Error) Parse(string source)
    {
        var fields = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var raw in (source ?? string.Empty).Split('\n'))
        {
            var line = Comment().Replace(raw, string.Empty).TrimEnd();
            if (line.Trim().Length == 0)
                continue;
            var m = Field().Match(line);
            if (!m.Success)
                return (null, "solfa block: write fields like `hymn: amazing-grace`");
            var value = m.Groups[2].Value.Trim();
            if (value.Length >= 2 && (value[0] == '"' && value[^1] == '"' || value[0] == '\'' && value[^1] == '\''))
                value = value[1..^1];
            fields[m.Groups[1].Value] = value;
        }
        return (fields, null);
    }

    /// <summary>YAML's false, null and empty read as false; anything else as true (the build's <c>!!value</c>).</summary>
    private static bool Truthy(string value)
        => value.Length > 0 && value is not ("false" or "False" or "FALSE" or "null" or "~" or "0");

    [GeneratedRegex(@"^[ \t]*```[ \t]*solfa[ \t]*\r?\n(?<src>[\s\S]*?)^[ \t]*```[ \t]*$", RegexOptions.Multiline)]
    private static partial Regex Block();

    [GeneratedRegex(@"(^|\s)#.*$")]
    private static partial Regex Comment();

    [GeneratedRegex(@"^([A-Za-z_][\w-]*)\s*:(?:\s+(.*)|\s*)$")]
    private static partial Regex Field();

    [GeneratedRegex(@"^(\d+)\s*-\s*(\d+)$")]
    private static partial Regex BarRange();
}
