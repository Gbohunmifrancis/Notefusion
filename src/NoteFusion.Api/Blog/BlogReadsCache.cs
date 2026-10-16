using MediatR;
using Microsoft.Extensions.Caching.Memory;
using NoteFusion.Application.Blog.Queries;
using NoteFusion.Shared.Results;

namespace NoteFusion.Api.Blog;

/// <summary>
/// Each page's read count, remembered per path for <see cref="Lifetime"/> on this instance, so a post that is
/// being shared around costs one count every few minutes rather than one per reader. The blog index, a post
/// and its "Keep reading" list ask for overlapping sets of paths, which is why the cache is per path rather
/// than per request: only the paths nobody asked about lately go to the database.
/// </summary>
public sealed class BlogReadsCache
{
    /// <summary>How long a count is reused: a new read shows up within this long.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(5);

    private readonly IMemoryCache _cache;

    public BlogReadsCache(IMemoryCache cache) => _cache = cache;

    /// <summary>The counts for these normalised paths: from the cache where it has them, one query for the rest.</summary>
    public async Task<Result<IReadOnlyDictionary<string, int>>> GetAsync(IReadOnlyList<string> paths, ISender sender, CancellationToken ct)
    {
        var answer = new Dictionary<string, int>(StringComparer.Ordinal);
        var misses = new List<string>();
        foreach (var path in paths)
        {
            if (_cache.TryGetValue(Key(path), out int count))
                answer[path] = count;
            else
                misses.Add(path);
        }

        if (misses.Count > 0)
        {
            var fresh = await sender.Send(new GetBlogReadsQuery(misses), ct);
            if (fresh.IsFailure)
                return fresh.Error;
            foreach (var (path, count) in fresh.Value)
            {
                _cache.Set(Key(path), count, Lifetime);
                answer[path] = count;
            }
        }

        return answer;
    }

    private static string Key(string path) => $"blog-reads:{path}";
}
