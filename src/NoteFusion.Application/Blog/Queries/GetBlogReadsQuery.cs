using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog.Queries;

/// <summary>
/// How many people have read each of these blog or hymn pages, for the "1,234 reads" on the site.
/// </summary>
/// <remarks>
/// <para>
/// A read is one browser that viewed the page: the distinct tracker visitor ids
/// (<see cref="WebEvent.VisitorId"/>) among the page's page-view rows. A reader who comes back the next day,
/// or opens the post in three tabs, is still one read, so a refresh-happy visitor cannot inflate it. It is a
/// floor on people rather than a count of views: a reader on two browsers counts twice, and one who cleared
/// their storage counts again.
/// </para>
/// <para>
/// Customers only, the way every analytics figure is (<see cref="AnalyticsScope.RealWebEvents"/>): a browser
/// ever signed in as an admin or internal account is left out, so the team's own checking of a post does not
/// count. Web events are kept for <see cref="TranscriptionLog.RetentionDays"/> days, so this is readers over
/// that window.
/// </para>
/// <para>Every path asked about is in the answer, 0 when nobody has read it, so the page can tell "no reads yet" from "no answer".</para>
/// </remarks>
public sealed record GetBlogReadsQuery(IReadOnlyList<string> Paths) : IRequest<Result<IReadOnlyDictionary<string, int>>>;

public sealed class GetBlogReadsQueryHandler : IRequestHandler<GetBlogReadsQuery, Result<IReadOnlyDictionary<string, int>>>
{
    private readonly IApplicationDbContext _db;

    public GetBlogReadsQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<IReadOnlyDictionary<string, int>>> Handle(GetBlogReadsQuery request, CancellationToken ct)
    {
        var paths = request.Paths.Select(BlogReadPaths.Normalise).OfType<string>().Distinct(StringComparer.Ordinal).ToList();
        if (paths.Count > BlogReadPaths.MaxPaths)
            return Error.Validation("BLOG_READS_TOO_MANY_PATHS", $"Ask for at most {BlogReadPaths.MaxPaths} pages at a time.");

        var counts = paths.ToDictionary(p => p, _ => 0, StringComparer.Ordinal);
        if (paths.Count == 0)
            return counts;

        var rows = await _db.RealWebEvents()
            .Where(e => e.Kind == WebEvent.Pageview && paths.Contains(e.Path))
            .GroupBy(e => e.Path)
            .Select(g => new { Path = g.Key, Readers = g.Select(e => e.VisitorId).Distinct().Count() })
            .ToListAsync(ct);

        foreach (var row in rows)
            counts[row.Path] = row.Readers;
        return counts;
    }
}
