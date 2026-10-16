using Microsoft.Extensions.Caching.Memory;
using NoteFusion.Api.Blog;
using NoteFusion.Application.Blog;
using NoteFusion.Application.Blog.Queries;
using NoteFusion.Application.Web.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>The "1,234 reads" on blog and hymn pages: unique readers per page, from the site's own page views.</summary>
public class BlogReadsTests
{
    private static readonly DateTime Now = new(2026, 10, 16, 12, 0, 0, DateTimeKind.Utc);
    private const string Post = "/blog/how-to-read-tonic-solfa";
    private const string Hymn = "/hymns/amazing-grace";

    private static async Task View(TestHarness h, string visitor, string session, Guid? user, params string[] paths)
        => await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(user), h.Clock)
            .Handle(new RecordWebEventsCommand(visitor, session,
                paths.Select(p => new WebEventInput("pageview", null, p, null, null, "mobile", null)).ToList()), default);

    private static async Task<IReadOnlyDictionary<string, int>> Reads(TestHarness h, params string[] paths)
    {
        var result = await new GetBlogReadsQueryHandler(h.Db).Handle(new GetBlogReadsQuery(paths), default);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    [Fact]
    public async Task A_read_is_one_browser_however_often_it_comes_back()
    {
        using var h = new TestHarness(Now);
        await View(h, "a", "a1", null, Post, Post);
        await View(h, "a", "a2", null, Post);          // the next day, another tab
        await View(h, "b", "b1", null, Post, Hymn);
        await View(h, "c", "c1", null, "/blog");       // the index is not the post

        var reads = await Reads(h, Post, Hymn);

        Assert.Equal(2, reads[Post]);
        Assert.Equal(1, reads[Hymn]);
    }

    [Fact]
    public async Task Clicks_and_actions_on_the_page_are_not_reads()
    {
        using var h = new TestHarness(Now);
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock).Handle(new RecordWebEventsCommand("a", "a1",
        [
            new WebEventInput("click", "CTA: blog", Post, "/app", null, "desktop", null),
            new WebEventInput("action", "Hymn played", Hymn, null, null, "desktop", null),
        ]), default);

        var reads = await Reads(h, Post, Hymn);

        Assert.Equal(0, reads[Post]);
        Assert.Equal(0, reads[Hymn]);
    }

    [Fact]
    public async Task The_team_reading_its_own_posts_is_not_counted()
    {
        using var h = new TestHarness(Now);
        var admin = User.Create("Ada Admin", "ada@notefusion.studio", "hash", Now);
        admin.PromoteToAdmin();
        var tester = User.Create("Tess Tester", "tess@example.com", "hash", Now);
        tester.SetInternal(true);
        h.Db.Users.AddRange(admin, tester);
        h.Db.SaveChanges();

        await View(h, "team-laptop", "t1", null, Post);         // read before signing in…
        await View(h, "team-laptop", "t2", admin.Id, "/app");   // …on a browser later signed in as an admin
        await View(h, "tester-phone", "p1", tester.Id, Post);
        await View(h, "reader", "r1", null, Post);

        Assert.Equal(1, (await Reads(h, Post))[Post]);
    }

    [Fact]
    public async Task Every_page_asked_about_is_answered_and_nothing_else()
    {
        using var h = new TestHarness(Now);
        await View(h, "a", "a1", null, Post, "/blog/another-post");

        var reads = await Reads(h, Post, Hymn, "/app", "/blog");

        Assert.Equal(new Dictionary<string, int> { [Post] = 1, [Hymn] = 0 }, reads);
    }

    [Theory]
    [InlineData("/blog/how-to-read-tonic-solfa", "/blog/how-to-read-tonic-solfa")]
    [InlineData(" /blog/how-to-read-tonic-solfa/ ", "/blog/how-to-read-tonic-solfa")]
    [InlineData("/Blog/How-To-Read-Tonic-Solfa?utm_source=whatsapp#faq", "/blog/how-to-read-tonic-solfa")]
    [InlineData("/hymns/amazing-grace/index.html", "/hymns/amazing-grace")]
    [InlineData("/blog/tag/choir", "/blog/tag/choir")]
    [InlineData("/blog", null)]
    [InlineData("/blog/", null)]
    [InlineData("/hymns", null)]
    [InlineData("/app", null)]
    [InlineData("/", null)]
    [InlineData("blog/no-leading-slash", null)]
    [InlineData("/blog/../app", null)]
    [InlineData("/blog//double", null)]
    [InlineData("/blog/<script>", null)]
    [InlineData("https://notefusion.studio/blog/x", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Paths_are_written_the_way_the_tracker_records_them(string? input, string? expected)
        => Assert.Equal(expected, BlogReadPaths.Normalise(input));

    [Fact]
    public void A_request_names_at_most_fifty_pages()
    {
        var fifty = string.Join(",", Enumerable.Range(0, 50).Select(i => $"/blog/post-{i}"));
        var parsed = BlogReadPaths.Parse(fifty + ",/blog/post-0/,/app");   // a duplicate and a non-blog page do not count
        Assert.True(parsed.IsSuccess);
        Assert.Equal(50, parsed.Value.Count);

        var tooMany = BlogReadPaths.Parse(fifty + ",/blog/post-50");
        Assert.True(tooMany.IsFailure);
        Assert.Equal(ErrorType.Validation, tooMany.Error.Type);

        var junk = BlogReadPaths.Parse(string.Join(",", Enumerable.Repeat("/x", 101)));
        Assert.True(junk.IsFailure);

        Assert.Empty(BlogReadPaths.Parse(null).Value);
    }

    [Fact]
    public async Task Counts_are_cached_per_page_for_a_few_minutes()
    {
        using var h = new TestHarness(Now);
        await View(h, "a", "a1", null, Post);
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var cache = new BlogReadsCache(memory);
        var sender = new HarnessSender(h);

        var first = await cache.GetAsync([Post], sender, default);
        await View(h, "b", "b1", null, Post, Hymn);
        var second = await cache.GetAsync([Post, Hymn], sender, default);

        Assert.Equal(1, first.Value[Post]);
        Assert.Equal(1, second.Value[Post]);   // still the cached count
        Assert.Equal(1, second.Value[Hymn]);   // not cached yet, so counted now
    }
}
