using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog;

/// <summary>A hymn's opening line exactly as the site's engine writes it, for the drafter's prompt.</summary>
public sealed record CatalogueLine(int Bars, string Solfa, string Words);

/// <summary>A published hymn the posts may cite in a ```solfa block.</summary>
public sealed record CatalogueHymn(
    string Slug,
    string Title,
    string? ShortTitle,
    string Key,
    string Header,
    string Time,
    int Bars,
    CatalogueLine FirstLine);

/// <summary>
/// What the live website holds, as its build published it at <c>/blog/catalogue.json</c>
/// (<c>tools/blog/lib/catalogue.mjs</c>): the hymns with their opening lines written by NoteFusion's solfa
/// engine, every page path, and the author ids. The API reads it to check a post's solfa blocks, links and
/// author before publishing, and to give the drafter the only solfa it may cite.
/// </summary>
public sealed record BlogCatalogue(
    IReadOnlyList<CatalogueHymn> Hymns,
    IReadOnlyList<string> Pages,
    IReadOnlyList<string> Authors)
{
    public static readonly BlogCatalogue Empty = new([], [], [BlogDefaults.Author]);

    public CatalogueHymn? Hymn(string slug) => Hymns.FirstOrDefault(h => h.Slug == slug);

    public bool HasPage(string path) => Pages.Contains(path, StringComparer.Ordinal);
}

/// <summary>Reads the site's catalogue (cached for a few minutes).</summary>
public interface IBlogSiteCatalogue
{
    /// <summary>The catalogue, or a Network error when the site could not be read.</summary>
    Task<Result<BlogCatalogue>> GetAsync(CancellationToken ct);
}

internal static class BlogDefaults
{
    public const string Author = Core.Entities.BlogPost.DefaultAuthor;
}
