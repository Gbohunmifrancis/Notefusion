using System.Text.RegularExpressions;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog;

/// <summary>
/// Which pages may have their reads counted, and how a path is written before it is looked up: the blog's
/// and the hymns' pages only, in the form the site's tracker records them (<c>web-site/assets/track.js</c>:
/// no query string, no fragment, no trailing slash, no <c>/index.html</c>).
/// </summary>
public static partial class BlogReadPaths
{
    /// <summary>The most paths one request may ask about. The blog index asks for a page of posts and the hymns.</summary>
    public const int MaxPaths = 50;

    /// <summary>
    /// Reads <c>?paths=/blog/a,/blog/b</c> into the distinct, normalised paths it names. A path that is not
    /// a blog or hymn page is left out (it has no read count to show); more than <see cref="MaxPaths"/>
    /// distinct paths is a validation error.
    /// </summary>
    public static Result<IReadOnlyList<string>> Parse(string? csv)
    {
        var raw = (csv ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        // Counted before normalising, so a long list of junk cannot pass the cap by being thrown away.
        if (raw.Length > MaxPaths * 2)
            return TooMany();

        var paths = raw.Select(Normalise).OfType<string>().Distinct(StringComparer.Ordinal).ToList();
        if (paths.Count > MaxPaths)
            return TooMany();
        return paths;
    }

    /// <summary>
    /// "/Blog/How-To/?x=1#top" → "/blog/how-to"; null for anything that is not a page under /blog/ or /hymns/.
    /// The site's slugs are lowercase, so case is folded.
    /// </summary>
    public static string? Normalise(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;
        var p = path.Trim();
        var cut = p.IndexOfAny(['?', '#']);
        if (cut >= 0)
            p = p[..cut];
        p = p.ToLowerInvariant();
        if (p.EndsWith("/index.html", StringComparison.Ordinal))
            p = p[..^"/index.html".Length];
        p = p.TrimEnd('/');
        return p.Length <= WebEvent.PathMaxLength && PagePath().IsMatch(p) ? p : null;
    }

    private static Error TooMany()
        => Error.Validation("BLOG_READS_TOO_MANY_PATHS", $"Ask for at most {MaxPaths} pages at a time.");

    [GeneratedRegex("^/(blog|hymns)(/[a-z0-9]+(-[a-z0-9]+)*)+$")]
    private static partial Regex PagePath();
}
