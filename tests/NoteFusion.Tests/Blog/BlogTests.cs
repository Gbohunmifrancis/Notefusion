using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Blog;
using NoteFusion.Application.Blog.Commands;
using NoteFusion.Application.Blog.Drafting;
using NoteFusion.Application.Blog.Dtos;
using NoteFusion.Application.Blog.Publishing;
using NoteFusion.Application.Blog.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Blog;

/// <summary>The blog in the database: editing, publishing, the site's rebuilds, scheduled posts and Gemini drafts.</summary>
public class BlogTests
{
    private static readonly DateTime Now = new(2026, 10, 16, 9, 0, 0, DateTimeKind.Utc);

    private sealed class Fixture : IDisposable
    {
        public TestHarness H { get; } = new(Now);
        public FakeCatalogue Catalogue { get; } = new();
        public FakeGitHub GitHub { get; } = new();
        public FakeGemini Gemini { get; } = new();
        public BlogSettings Settings { get; }
        public User Admin { get; }

        public Fixture(bool autoPublish = true)
        {
            Settings = new() { GeminiRetryDelays = [TimeSpan.Zero], AutoPublishDrafts = autoPublish };
            Admin = User.CreateAdmin("Ada Admin", "ada@notefusion.studio", "hash", Now);
            H.Db.Users.Add(Admin);
            H.Db.SaveChanges();
        }

        public async Task<BlogPostDto> Create(BlogPostInput? input = null)
        {
            var r = await new CreateBlogPostCommandHandler(H.Db, H.Clock, Settings).Handle(new CreateBlogPostCommand(input ?? BlogSamples.Input()), default);
            Assert.True(r.IsSuccess, r.IsFailure ? r.Error.Message : null);
            return r.Value;
        }

        public Task<Result<BlogPostDto>> Update(BlogPostDto post, BlogPostInput input)
            => new UpdateBlogPostCommandHandler(H.Db, H.Clock, Settings, Catalogue).Handle(new UpdateBlogPostCommand(post.Id, post.Version, input), default);

        public Task<Result<BlogPostDto>> Act(Guid id, BlogPostAction action, DateTime? at = null)
            => new ChangeBlogPostStatusCommandHandler(H.Db, Catalogue, H.AuditAs(Admin), H.Clock, Settings)
                .Handle(new ChangeBlogPostStatusCommand(id, action, at), default);

        public BlogSitePublisher Publisher() => new(H.Db, GitHub, Settings, H.Clock, NullLogger<BlogSitePublisher>.Instance);

        public BlogGenerationRunner Runner()
            => new(H.Db, Gemini, Catalogue, new BlogDraftWriter(Gemini, Settings, NullLogger<BlogDraftWriter>.Instance), Settings, H.Clock,
                NullLogger<BlogGenerationRunner>.Instance);

        public int PendingRebuilds => H.Db.BlogSiteRebuilds.Count(r => r.DispatchedAtUtc == null);

        public void Dispose() => H.Dispose();
    }

    // ── Editing ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_new_post_is_a_draft_and_its_slug_is_unique()
    {
        using var f = new Fixture();
        var post = await f.Create();
        Assert.Equal("Draft", post.Status);
        Assert.Equal("Manual", post.Source);
        Assert.Equal("/blog/a-new-post", post.Path);

        var again = await new CreateBlogPostCommandHandler(f.H.Db, f.H.Clock, f.Settings).Handle(new CreateBlogPostCommand(BlogSamples.Input()), default);
        Assert.Equal("BLOG_SLUG_TAKEN", again.Error.Code);

        var other = await f.Create(BlogSamples.Input("another-post", "Another Post About Choirs"));
        var clash = await f.Update(other, BlogSamples.Input("a-new-post", "Another Post About Choirs"));
        Assert.Equal("BLOG_SLUG_TAKEN", clash.Error.Code);
    }

    [Fact]
    public async Task A_slug_that_is_not_lowercase_words_is_refused()
    {
        using var f = new Fixture();
        var r = await new CreateBlogPostCommandHandler(f.H.Db, f.H.Clock, f.Settings).Handle(new CreateBlogPostCommand(BlogSamples.Input("Bad Slug!")), default);
        Assert.Equal("BLOG_POST_INVALID", r.Error.Code);
    }

    [Fact]
    public async Task Saving_over_a_newer_version_is_a_conflict_not_an_overwrite()
    {
        using var f = new Fixture();
        var post = await f.Create();
        var first = await f.Update(post, BlogSamples.Input(title: "A First Edit About Choirs"));
        Assert.True(first.IsSuccess);

        var stale = await f.Update(post, BlogSamples.Input(title: "A Stale Edit About Choirs"));
        Assert.Equal("BLOG_POST_CHANGED", stale.Error.Code);
        Assert.Equal("A First Edit About Choirs", f.H.Db.BlogPosts.Single().Title);
    }

    [Fact]
    public async Task A_published_post_keeps_its_slug()
    {
        using var f = new Fixture();
        var post = await f.Create();
        post = (await f.Act(post.Id, BlogPostAction.Publish)).Value;
        Assert.True(post.SlugLocked);

        var moved = await f.Update(post, BlogSamples.Input("a-moved-post"));
        Assert.Equal("BLOG_SLUG_LOCKED", moved.Error.Code);
    }

    [Fact]
    public async Task Duplicating_makes_a_new_draft_at_a_free_slug()
    {
        using var f = new Fixture();
        var post = await f.Create();
        var handler = new DuplicateBlogPostCommandHandler(f.H.Db, f.H.Clock, f.Settings);
        var a = (await handler.Handle(new DuplicateBlogPostCommand(post.Id), default)).Value;
        var b = (await handler.Handle(new DuplicateBlogPostCommand(post.Id), default)).Value;
        Assert.Equal("a-new-post-copy", a.Slug);
        Assert.Equal("a-new-post-copy-2", b.Slug);
        Assert.Equal("Draft", b.Status);
        Assert.Equal(post.Body, b.Body);
    }

    [Fact]
    public async Task A_live_post_cannot_be_deleted_but_a_draft_can()
    {
        using var f = new Fixture();
        var post = await f.Create();
        await f.Act(post.Id, BlogPostAction.Publish);
        var handler = new DeleteBlogPostCommandHandler(f.H.Db, f.H.AuditAs(f.Admin));
        Assert.Equal("BLOG_POST_LIVE", (await handler.Handle(new DeleteBlogPostCommand(post.Id), default)).Error.Code);

        await f.Act(post.Id, BlogPostAction.Archive);
        Assert.True((await handler.Handle(new DeleteBlogPostCommand(post.Id), default)).IsSuccess);
        Assert.Empty(f.H.Db.BlogPosts);
        Assert.Contains(f.H.Db.AdminAuditLogs, a => a.Action == AdminAuditAction.DeleteBlogPost);
    }

    // ── Status ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Publishing_runs_the_checks_and_refuses_a_post_the_build_could_not_render()
    {
        using var f = new Fixture();
        var post = await f.Create(BlogSamples.Input(body: BlogSamples.GoodBody() + "\n```solfa\nhymn: no-such-hymn\n```\n"));

        var r = await f.Act(post.Id, BlogPostAction.Publish);

        Assert.Equal("BLOG_POST_NOT_READY", r.Error.Code);
        Assert.Contains("no published hymn \"no-such-hymn\"", r.Error.Message);
        Assert.Equal(BlogPostStatus.Draft, f.H.Db.BlogPosts.Single().Status);
        Assert.Equal(0, f.PendingRebuilds);
    }

    [Fact]
    public async Task Publish_unpublish_archive_each_ask_for_one_rebuild_and_are_audited()
    {
        using var f = new Fixture();
        var post = await f.Create();

        var live = await f.Act(post.Id, BlogPostAction.Publish);
        Assert.Equal("Published", live.Value.Status);
        Assert.Equal(Now, live.Value.PublishedAtUtc);
        Assert.Equal(1, f.PendingRebuilds);
        Assert.Equal("BLOG_POST_ALREADY_LIVE", (await f.Act(post.Id, BlogPostAction.Publish)).Error.Code);

        f.H.Clock.UtcNow = Now.AddDays(1);
        var draft = await f.Act(post.Id, BlogPostAction.Unpublish);
        Assert.Equal("Draft", draft.Value.Status);
        Assert.Equal(2, f.PendingRebuilds);
        Assert.Equal("BLOG_POST_ALREADY_DRAFT", (await f.Act(post.Id, BlogPostAction.Unpublish)).Error.Code);

        // Republished, it keeps its first date; archived from live, it asks for another rebuild.
        var again = await f.Act(post.Id, BlogPostAction.Publish);
        Assert.Equal(Now, again.Value.PublishedAtUtc);
        await f.Act(post.Id, BlogPostAction.Archive);
        Assert.Equal(4, f.PendingRebuilds);

        var actions = f.H.Db.AdminAuditLogs.Select(a => a.Action).ToList();
        Assert.Equal(2, actions.Count(a => a == AdminAuditAction.PublishBlogPost));
        Assert.Contains(AdminAuditAction.UnpublishBlogPost, actions);
        Assert.Contains(AdminAuditAction.ArchiveBlogPost, actions);
    }

    [Fact]
    public async Task Editing_a_live_post_revises_it_and_asks_for_a_rebuild_but_a_draft_edit_does_not()
    {
        using var f = new Fixture();
        var post = await f.Create();
        post = (await f.Update(post, BlogSamples.Input(title: "A Draft Edit About Choirs"))).Value;
        Assert.Equal(0, f.PendingRebuilds);

        post = (await f.Act(post.Id, BlogPostAction.Publish)).Value;
        f.H.Clock.UtcNow = Now.AddDays(2);
        var edited = await f.Update(post, BlogSamples.Input(title: "A Live Edit About Choirs"));

        Assert.True(edited.IsSuccess);
        Assert.Equal(Now.AddDays(2), edited.Value.RevisedAtUtc);
        Assert.Equal(2, f.PendingRebuilds);

        // A no-op save of a live post changes nothing on the site.
        var same = await f.Update(edited.Value, BlogSamples.Input(title: "A Live Edit About Choirs"));
        Assert.True(same.IsSuccess);
        Assert.Equal(2, f.PendingRebuilds);
    }

    [Fact]
    public async Task An_edit_that_would_break_a_live_post_is_refused_unsaved()
    {
        using var f = new Fixture();
        var post = (await f.Act((await f.Create()).Id, BlogPostAction.Publish)).Value;

        var broken = await f.Update(post, BlogSamples.Input(body: "# A second title\n\n" + BlogSamples.GoodBody()));

        Assert.Equal("BLOG_POST_NOT_READY", broken.Error.Code);
        Assert.DoesNotContain("# A second title", f.H.Db.BlogPosts.AsNoTracking().Single().Body);
    }

    [Fact]
    public async Task Scheduling_needs_a_future_time_and_the_worker_publishes_it_when_due()
    {
        using var f = new Fixture();
        var post = await f.Create();
        Assert.Equal("BLOG_SCHEDULE_IN_PAST", (await f.Act(post.Id, BlogPostAction.Schedule, Now.AddMinutes(-5))).Error.Code);

        var at = Now.AddHours(3);
        var scheduled = await f.Act(post.Id, BlogPostAction.Schedule, at);
        Assert.Equal("Scheduled", scheduled.Value.Status);
        Assert.Equal(0, f.PendingRebuilds); // nothing on the site changes yet

        var publisher = f.Publisher();
        f.H.Clock.UtcNow = at.AddMinutes(-1);
        Assert.Equal(0, await publisher.PublishDueAsync(default));
        f.H.Clock.UtcNow = at.AddSeconds(10);
        Assert.Equal(1, await publisher.PublishDueAsync(default));

        var live = f.H.Db.BlogPosts.Single();
        Assert.Equal(BlogPostStatus.Published, live.Status);
        Assert.Equal(at, live.PublishedAtUtc); // dated its scheduled time
        Assert.Equal(1, f.PendingRebuilds);
    }

    // ── Rebuilds ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Rebuilds_wait_for_a_quiet_spell_coalesce_a_burst_and_keep_two_minutes_apart()
    {
        using var f = new Fixture();
        var publisher = f.Publisher();
        void Request(string why) { BlogSiteChanges.RequestRebuild(f.H.Db, why, f.H.Clock.UtcNow); f.H.Db.SaveChanges(); }

        Request("one");
        f.H.Clock.UtcNow = Now.AddSeconds(5);
        Request("two");
        f.H.Clock.UtcNow = Now.AddSeconds(15);
        Assert.False(await publisher.DispatchRebuildIfDueAsync(default)); // still busy: 10 s since the last change

        f.H.Clock.UtcNow = Now.AddSeconds(26);
        Assert.True(await publisher.DispatchRebuildIfDueAsync(default));
        Assert.Equal(1, f.GitHub.Dispatches); // both changes, one deploy
        Assert.Equal(0, f.PendingRebuilds);

        Request("three");
        f.H.Clock.UtcNow = Now.AddSeconds(60);
        Assert.False(await publisher.DispatchRebuildIfDueAsync(default)); // within two minutes of the last dispatch
        f.H.Clock.UtcNow = Now.AddSeconds(26 + 121);
        Assert.True(await publisher.DispatchRebuildIfDueAsync(default));
        Assert.Equal(2, f.GitHub.Dispatches);
    }

    [Fact]
    public async Task A_burst_that_never_goes_quiet_is_still_built_within_the_maximum_wait()
    {
        using var f = new Fixture();
        var publisher = f.Publisher();
        for (var s = 0; s <= 130; s += 10)
        {
            f.H.Clock.UtcNow = Now.AddSeconds(s);
            BlogSiteChanges.RequestRebuild(f.H.Db, $"edit {s}", f.H.Clock.UtcNow);
            f.H.Db.SaveChanges();
            if (await publisher.DispatchRebuildIfDueAsync(default))
                break;
        }
        Assert.Equal(1, f.GitHub.Dispatches);
        Assert.True(f.H.Clock.UtcNow <= Now.AddMinutes(2).AddSeconds(10));
    }

    [Fact]
    public async Task A_failed_dispatch_keeps_the_requests_and_retries_after_the_delay()
    {
        using var f = new Fixture();
        var publisher = f.Publisher();
        BlogSiteChanges.RequestRebuild(f.H.Db, "one", Now);
        f.H.Db.SaveChanges();
        f.GitHub.FailWith = Error.Failure("GITHUB_REFUSED", "GitHub answered 403");

        f.H.Clock.UtcNow = Now.AddMinutes(1);
        Assert.False(await publisher.DispatchRebuildIfDueAsync(default));
        Assert.Equal(1, f.PendingRebuilds);
        Assert.Equal("GitHub answered 403", f.H.Db.BlogSiteRebuilds.Single().Error);

        f.GitHub.FailWith = null;
        f.H.Clock.UtcNow = Now.AddMinutes(2);
        Assert.False(await publisher.DispatchRebuildIfDueAsync(default)); // retry waits two minutes
        f.H.Clock.UtcNow = Now.AddMinutes(3).AddSeconds(1);
        Assert.True(await publisher.DispatchRebuildIfDueAsync(default));
        Assert.Equal(0, f.PendingRebuilds);
    }

    [Fact]
    public async Task Without_a_GitHub_token_changes_wait_unbuilt()
    {
        using var f = new Fixture();
        f.GitHub.IsConfigured = false;
        BlogSiteChanges.RequestRebuild(f.H.Db, "one", Now);
        f.H.Db.SaveChanges();
        f.H.Clock.UtcNow = Now.AddHours(1);
        Assert.False(await f.Publisher().DispatchRebuildIfDueAsync(default));
        Assert.Equal(0, f.GitHub.Dispatches);
        Assert.Equal(1, f.PendingRebuilds);
    }

    // ── The published endpoint ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_published_list_holds_only_live_posts_dated_in_Lagos_with_everything_the_build_needs()
    {
        using var f = new Fixture();
        var live = await f.Create(BlogSamples.Input() with
        {
            Cover = new BlogCoverDto("/assets/blog/cover.jpg", "A choir", 1200, 630),
            SeoTitle = "Teach a Song Fast | NoteFusion",
        });
        f.H.Clock.UtcNow = new DateTime(2026, 10, 16, 23, 30, 0, DateTimeKind.Utc); // already the 17th in Lagos
        await f.Act(live.Id, BlogPostAction.Publish);
        await f.Create(BlogSamples.Input("still-a-draft", "Still a Draft About Choirs"));
        var scheduled = await f.Create(BlogSamples.Input("scheduled-post", "A Scheduled Post About Choirs"));
        await f.Act(scheduled.Id, BlogPostAction.Schedule, f.H.Clock.UtcNow.AddDays(1));

        var r = await new GetPublishedBlogPostsQueryHandler(f.H.Db).Handle(new GetPublishedBlogPostsQuery(), default);

        var post = Assert.Single(r.Value.Posts);
        Assert.Equal("a-new-post", post.Slug);
        Assert.Equal("2026-10-17", post.Date);
        Assert.Null(post.Updated);
        Assert.Equal(new BlogCoverDto("/assets/blog/cover.jpg", "A choir", 1200, 630), post.Cover);
        Assert.Equal("Teach a Song Fast | NoteFusion", post.SeoTitle);
        Assert.Equal(["choir"], post.Tags);
        Assert.Single(post.Faq);
        Assert.StartsWith("Learning a new song", post.Body);
        Assert.Equal("francis", post.Author);
        Assert.Matches("^[0-9a-f]{16}$", r.Value.Version);

        // An edit on a later day shows as "updated"; the version moves with the content.
        var dto = (await new GetBlogPostQueryHandler(f.H.Db, f.Settings).Handle(new GetBlogPostQuery(live.Id), default)).Value;
        f.H.Clock.UtcNow = f.H.Clock.UtcNow.AddDays(3);
        await f.Update(dto, BlogSamples.Input(title: "A Revised Post About Choirs"));
        var after = await new GetPublishedBlogPostsQueryHandler(f.H.Db).Handle(new GetPublishedBlogPostsQuery(), default);
        Assert.Equal("2026-10-20", after.Value.Posts.Single().Updated);
        Assert.NotEqual(r.Value.Version, after.Value.Version);
    }

    // ── Topics and drafting ─────────────────────────────────────────────────────────────────

    private static async Task<BlogTopic> Topic(Fixture f, string slug, int position, params string[] links)
    {
        var r = await new CreateBlogTopicCommandHandler(f.H.Db, f.H.Clock).Handle(
            new CreateBlogTopicCommand(new BlogTopicInput(slug, $"keyword for {slug}", "How-to", "An angle", links, position, null)), default);
        Assert.True(r.IsSuccess, r.IsFailure ? r.Error.Message : null);
        return f.H.Db.BlogTopics.Single(t => t.Slug == slug);
    }

    private static async Task<BlogGenerationRunDto> Generate(Fixture f, int count, Guid? topicId = null, string? topic = null)
    {
        var r = await new GenerateBlogDraftsCommandHandler(f.H.Db, f.Gemini, f.H.AuditAs(f.Admin), new StubCurrentUser(f.Admin.Id), f.H.Clock)
            .Handle(new GenerateBlogDraftsCommand(count, topicId, topic), default);
        Assert.True(r.IsSuccess, r.IsFailure ? r.Error.Message : null);
        return r.Value;
    }

    [Fact]
    public async Task Topics_are_unique_by_slug_and_queue_at_the_end()
    {
        using var f = new Fixture();
        var a = await Topic(f, "first-topic", 10);
        var b = await new CreateBlogTopicCommandHandler(f.H.Db, f.H.Clock).Handle(
            new CreateBlogTopicCommand(new BlogTopicInput("second-topic", "second", null, null, ["/hymns"], null, null)), default);
        Assert.Equal(a.Position + 10, b.Value.Position);

        var dup = await new CreateBlogTopicCommandHandler(f.H.Db, f.H.Clock).Handle(
            new CreateBlogTopicCommand(new BlogTopicInput("first-topic", "again", null, null, null, null, null)), default);
        Assert.Equal("BLOG_TOPIC_EXISTS", dup.Error.Code);

        var badLink = await new CreateBlogTopicCommandHandler(f.H.Db, f.H.Clock).Handle(
            new CreateBlogTopicCommand(new BlogTopicInput("third-topic", "third", null, null, ["https://example.com"], null, null)), default);
        Assert.Equal("BLOG_TOPIC_INVALID", badLink.Error.Code);
    }

    [Fact]
    public async Task Generating_is_refused_without_a_key_and_validates_the_request()
    {
        using var f = new Fixture();
        var handler = new GenerateBlogDraftsCommandHandler(f.H.Db, f.Gemini, f.H.AuditAs(f.Admin), new StubCurrentUser(f.Admin.Id), f.H.Clock);
        Assert.Equal("BLOG_GENERATE_COUNT", (await handler.Handle(new GenerateBlogDraftsCommand(11, null, null), default)).Error.Code);
        Assert.Equal("BLOG_GENERATE_COUNT", (await handler.Handle(new GenerateBlogDraftsCommand(3, null, "my own topic"), default)).Error.Code);
        f.Gemini.IsConfigured = false;
        Assert.Equal("GEMINI_NOT_CONFIGURED", (await handler.Handle(new GenerateBlogDraftsCommand(1, null, null), default)).Error.Code);
    }

    [Fact]
    public async Task A_batch_drafts_the_next_topics_saves_drafts_with_their_tokens_and_uses_the_topics()
    {
        using var f = new Fixture();
        // The first topic already has a post: it is marked used and passed over.
        await f.Create(BlogSamples.Input("already-written", "Already Written About Choirs"));
        await Topic(f, "already-written", 5);
        var t1 = await Topic(f, "how-to-teach-a-choir-a-new-song", 10, "/blog/how-to-read-tonic-solfa", "/blog/not-published-yet");
        var t2 = await Topic(f, "choir-rehearsal-tips", 20);
        await Topic(f, "left-for-later", 30);

        f.Gemini.Answer(BlogSamples.GoodDraft("how-to-teach-a-choir-a-new-song", links: ["/blog/how-to-read-tonic-solfa"]))
            .Answer(BlogSamples.GoodDraft("choir-rehearsal-tips", title: "Choir Rehearsal Tips for Church Choirs That Work"));

        var queued = await Generate(f, 2);
        Assert.Equal("Queued", queued.Status);
        Assert.True(await f.Runner().RunNextAsync(default));

        var run = f.H.Db.BlogGenerationRuns.AsNoTracking().Single();
        Assert.Equal(BlogGenerationStatus.Succeeded, run.Status);
        Assert.Equal(2, run.Items.Count);
        Assert.All(run.Items, i => Assert.True(i.PassedChecks, string.Join(" | ", i.Problems)));
        Assert.Equal(2 * 3500, run.TotalTokens);

        var drafts = f.H.Db.BlogPosts.AsNoTracking().Where(p => p.Source == BlogPostSource.Gemini).OrderBy(p => p.Slug).ToList();
        Assert.Equal(["choir-rehearsal-tips", "how-to-teach-a-choir-a-new-song"], drafts.Select(p => p.Slug));
        Assert.All(drafts, p => Assert.Equal(BlogPostStatus.Published, p.Status)); // both passed every check
        Assert.Equal(2, f.PendingRebuilds);
        var teach = drafts.Single(p => p.Slug == "how-to-teach-a-choir-a-new-song");
        Assert.Equal(BlogSettings.DefaultModel, teach.GenerationModel);
        Assert.Equal(BlogSettings.DefaultModel, run.Model);
        Assert.Equal(new BlogTokenUsage("Draft", 1000, 2000, 500, 0, 3500), Assert.Single(teach.GenerationUsage));
        Assert.Equal("keyword for how-to-teach-a-choir-a-new-song", teach.Keyword);
        Assert.Equal(t1.Id, teach.TopicId);
        Assert.Empty(teach.ReviewNotes);

        var topics = f.H.Db.BlogTopics.AsNoTracking().ToDictionary(t => t.Slug);
        Assert.Equal(BlogTopicStatus.Used, topics["already-written"].Status);
        Assert.Equal(BlogTopicStatus.Used, topics["how-to-teach-a-choir-a-new-song"].Status);
        Assert.Equal(teach.Id, topics["how-to-teach-a-choir-a-new-song"].PostId);
        Assert.Equal(BlogTopicStatus.Used, topics["choir-rehearsal-tips"].Status);
        Assert.Equal(BlogTopicStatus.Unused, topics["left-for-later"].Status);

        // The prompt carried the rules, the catalogue's engine-written solfa, and only the links that exist.
        var prompt = f.Gemini.Requests[0];
        Assert.Contains("Never write solfa sequences yourself", prompt.System);
        var user = prompt.Contents[0].PartsJson;
        Assert.Contains("hymn: amazing-grace", user);
        Assert.Contains("/blog/how-to-read-tonic-solfa", user);
        Assert.DoesNotContain("not-published-yet", user);
        Assert.Contains("gemini", prompt.Model);
    }

    [Fact]
    public async Task With_auto_publish_off_every_draft_waits_for_the_founder()
    {
        using var f = new Fixture(autoPublish: false);
        await Topic(f, "how-to-teach-a-choir-a-new-song", 10);
        f.Gemini.Answer(BlogSamples.GoodDraft());

        await Generate(f, 1);
        await f.Runner().RunNextAsync(default);

        Assert.Equal(BlogPostStatus.Draft, f.H.Db.BlogPosts.AsNoTracking().Single().Status);
        Assert.Equal(0, f.PendingRebuilds);
        Assert.Equal(0, await f.Runner().PublishWaitingDraftsAsync(default));
    }

    [Fact]
    public async Task At_start_up_an_untouched_clean_gemini_draft_goes_live_but_edited_or_flagged_ones_do_not()
    {
        using var f = new Fixture(autoPublish: false);
        await Topic(f, "how-to-teach-a-choir-a-new-song", 10);
        await Topic(f, "choir-rehearsal-tips", 20);
        await Topic(f, "left-for-the-founder", 30);
        var weak = new { title = "How to Teach a Choir a New Song Before Sunday", description = "Short.", slug = "s", tags = new[] { "choir" }, faq = Array.Empty<object>(), body = "## One\n\nToo short." };
        f.Gemini.Answer(BlogSamples.GoodDraft("how-to-teach-a-choir-a-new-song"))
            .Answer(BlogSamples.GoodDraft("choir-rehearsal-tips", title: "Choir Rehearsal Tips for Church Choirs That Work"))
            .Answer(weak).Answer(weak);
        await Generate(f, 3);
        await f.Runner().RunNextAsync(default);
        // The founder edits one draft by hand; that one is theirs to publish.
        var edited = f.H.Db.BlogPosts.Single(p => p.Slug == "choir-rehearsal-tips");
        edited.ClearReviewNotes(Now);
        f.H.Db.SaveChanges();

        var settings = new BlogSettings { GeminiRetryDelays = [TimeSpan.Zero] }; // auto-publish is the default
        var runner = new BlogGenerationRunner(f.H.Db, f.Gemini, f.Catalogue,
            new BlogDraftWriter(f.Gemini, settings, NullLogger<BlogDraftWriter>.Instance), settings, f.H.Clock,
            NullLogger<BlogGenerationRunner>.Instance);
        Assert.Equal(1, await runner.PublishWaitingDraftsAsync(default));

        var status = f.H.Db.BlogPosts.AsNoTracking().ToDictionary(p => p.Slug, p => p.Status);
        Assert.Equal(BlogPostStatus.Published, status["how-to-teach-a-choir-a-new-song"]);
        Assert.Equal(BlogPostStatus.Draft, status["choir-rehearsal-tips"]);
        Assert.Equal(BlogPostStatus.Draft, status["left-for-the-founder"]);
        Assert.Equal(1, f.PendingRebuilds);
        Assert.Equal(0, await runner.PublishWaitingDraftsAsync(default));
    }

    [Fact]
    public async Task A_draft_that_fails_the_checks_gets_one_revision_with_the_problems()
    {
        using var f = new Fixture();
        await Topic(f, "how-to-teach-a-choir-a-new-song", 10);
        var bad = new
        {
            title = "Teach",
            description = "Too short.",
            slug = "x",
            tags = new[] { "choir" },
            faq = Array.Empty<object>(),
            body = "Studies show 80% of choirs delve into d r m f s l t d' s l. Lorem ipsum.",
        };
        f.Gemini.Answer(bad).Answer(BlogSamples.GoodDraft(), prompt: 3000, output: 2500, thinking: 0);

        await Generate(f, 1);
        await f.Runner().RunNextAsync(default);

        Assert.Equal(2, f.Gemini.Requests.Count);
        var revision = f.Gemini.Requests[1].Contents;
        Assert.Equal(["user", "model", "user"], revision.Select(c => c.Role));
        var asked = revision[2].PartsJson;
        Assert.Contains("The title is 5 characters", asked);
        Assert.Contains("a percentage", asked);
        Assert.Contains("delve", asked);
        Assert.Contains("Link to /app", asked);

        var post = f.H.Db.BlogPosts.AsNoTracking().Single();
        Assert.Empty(post.ReviewNotes);
        Assert.Equal(["Draft", "Revision"], post.GenerationUsage.Select(u => u.Call));
        Assert.Equal(BlogGenerationStatus.Succeeded, f.H.Db.BlogGenerationRuns.AsNoTracking().Single().Status);
    }

    [Fact]
    public async Task A_draft_still_failing_after_the_revision_is_kept_with_its_problems_for_the_founder()
    {
        using var f = new Fixture();
        await Topic(f, "how-to-teach-a-choir-a-new-song", 10);
        var weak = new { title = "How to Teach a Choir a New Song Before Sunday", description = "Short.", slug = "s", tags = new[] { "choir" }, faq = Array.Empty<object>(), body = "## One\n\nToo short." };
        f.Gemini.Answer(weak).Answer(weak);

        await Generate(f, 1);
        await f.Runner().RunNextAsync(default);

        var post = f.H.Db.BlogPosts.AsNoTracking().Single();
        Assert.Equal(BlogPostStatus.Draft, post.Status);
        Assert.Contains(post.ReviewNotes, n => n.StartsWith("The description is 6 characters"));
        var run = f.H.Db.BlogGenerationRuns.AsNoTracking().Single();
        Assert.Equal(BlogGenerationStatus.Partial, run.Status);
        Assert.False(run.Items.Single().PassedChecks);
    }

    [Fact]
    public async Task A_rate_limit_is_tried_once_more_and_a_refusal_stops_the_batch()
    {
        using var f = new Fixture();
        await Topic(f, "how-to-teach-a-choir-a-new-song", 10);
        await Topic(f, "choir-rehearsal-tips", 20);
        f.Gemini.Fail(Error.Network("GEMINI_RATE_LIMITED", "429"), 429).Answer(BlogSamples.GoodDraft())
            .Fail(Error.Failure("GEMINI_ERROR", "Gemini API error 403: bad key"), 403);

        await Generate(f, 2);
        await f.Runner().RunNextAsync(default);

        var run = f.H.Db.BlogGenerationRuns.AsNoTracking().Single();
        Assert.Equal(BlogGenerationStatus.Partial, run.Status);
        Assert.Equal(2, run.Items.Count);
        Assert.NotNull(run.Items[0].PostId);
        Assert.Null(run.Items[1].PostId);
        Assert.Contains("403", run.Error);
        Assert.Equal(3, f.Gemini.Requests.Count);
    }

    [Fact]
    public async Task A_free_text_topic_drafts_one_post_at_its_own_slug()
    {
        using var f = new Fixture();
        await f.Create(BlogSamples.Input("singing-in-tune", "Singing in Tune Before"));
        f.Gemini.Answer(BlogSamples.GoodDraft("whatever"));

        await Generate(f, 1, topic: "Singing in tune");
        await f.Runner().RunNextAsync(default);

        Assert.Contains(f.H.Db.BlogPosts.AsNoTracking(), p => p.Slug == "singing-in-tune-2" && p.Source == BlogPostSource.Gemini);
    }

    [Fact]
    public async Task The_schedule_queues_one_batch_per_slot_and_none_without_a_key()
    {
        using var f = new Fixture(); // Friday 16 October 2026, 09:00 UTC
        var runner = f.Runner();
        Assert.Equal(new DateTime(2026, 10, 15, 5, 30, 0, DateTimeKind.Utc), runner.LatestSlot(Now)); // Thursday

        Assert.Null(await runner.QueueScheduledIfDueAsync(default)); // Thursday's slot is 27 h ago: missed, skipped

        f.H.Clock.UtcNow = new DateTime(2026, 10, 19, 5, 31, 0, DateTimeKind.Utc); // Monday
        var run = await runner.QueueScheduledIfDueAsync(default);
        Assert.NotNull(run);
        Assert.Equal(BlogGenerationTrigger.Schedule, run!.Trigger);
        f.H.Clock.UtcNow = f.H.Clock.UtcNow.AddMinutes(20);
        Assert.Null(await runner.QueueScheduledIfDueAsync(default));

        f.Gemini.IsConfigured = false;
        f.H.Clock.UtcNow = new DateTime(2026, 10, 22, 6, 0, 0, DateTimeKind.Utc); // Thursday
        Assert.Null(await runner.QueueScheduledIfDueAsync(default));
    }

    [Fact]
    public async Task A_batch_left_running_by_a_restart_is_closed()
    {
        using var f = new Fixture();
        var run = BlogGenerationRun.Queue(BlogGenerationTrigger.Admin, 2, null, null, null, Now);
        run.Start("gemini", Now);
        f.H.Db.BlogGenerationRuns.Add(run);
        f.H.Db.SaveChanges();

        await f.Runner().CloseInterruptedAsync(default);

        var closed = f.H.Db.BlogGenerationRuns.AsNoTracking().Single();
        Assert.Equal(BlogGenerationStatus.Failed, closed.Status);
        Assert.Contains("restart", closed.Error);
    }
}
