using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Blog.Commands;
using NoteFusion.Application.Blog.Publishing;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Blog.Drafting;

/// <summary>
/// Works through the queued batches of drafts, one at a time (the blog draft worker calls it), and queues the
/// twice-weekly batch. Each draft is saved the moment it is written — so the console shows progress and a crash
/// loses at most the draft in hand — with its tokens and whatever the checks still found. With
/// <see cref="BlogSettings.AutoPublishDrafts"/> a draft the checks passed goes live at once (and the site is
/// rebuilt); one with problems left stays a <see cref="BlogPostStatus.Draft"/> for the founder.
/// </summary>
public sealed class BlogGenerationRunner
{
    private readonly IApplicationDbContext _db;
    private readonly IGeminiClient _gemini;
    private readonly IBlogSiteCatalogue _catalogue;
    private readonly BlogDraftWriter _writer;
    private readonly BlogSettings _settings;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<BlogGenerationRunner> _logger;
    private readonly IProviderHealth _health;

    public BlogGenerationRunner(
        IApplicationDbContext db,
        IGeminiClient gemini,
        IBlogSiteCatalogue catalogue,
        BlogDraftWriter writer,
        BlogSettings settings,
        IDateTimeProvider clock,
        ILogger<BlogGenerationRunner> logger,
        IProviderHealth? health = null)
    {
        _health = health ?? ProviderHealth.AlwaysAvailable;
        _db = db;
        _gemini = gemini;
        _catalogue = catalogue;
        _writer = writer;
        _settings = settings;
        _clock = clock;
        _logger = logger;
    }

    /// <summary>At start-up: a batch left running by a restart is closed, keeping the drafts it saved.</summary>
    public async Task CloseInterruptedAsync(CancellationToken ct)
    {
        var stuck = await _db.BlogGenerationRuns.Where(r => r.Status == BlogGenerationStatus.Running).ToListAsync(ct);
        foreach (var run in stuck)
            run.Finish(_clock.UtcNow, "Interrupted by a restart of the API; the drafts saved before it are kept.");
        if (stuck.Count > 0)
            await _db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// At start-up, with <see cref="BlogSettings.AutoPublishDrafts"/>: a Gemini draft written while drafts were
    /// kept for review (or that fell short of a check since relaxed), that nobody has touched since (its first
    /// <see cref="BlogPost.Version"/>), goes live when today's checks flag nothing — its stored review notes are
    /// from the day it was written and are cleared. A draft the founder edited or took off the site is left alone.
    /// Returns how many went live.
    /// </summary>
    public async Task<int> PublishWaitingDraftsAsync(CancellationToken ct)
    {
        if (!_settings.AutoPublishDrafts)
            return 0;
        var waiting = await _db.BlogPosts
            .Where(p => p.Source == BlogPostSource.Gemini && p.Status == BlogPostStatus.Draft && p.Version == 1)
            .ToListAsync(ct);
        var published = 0;
        foreach (var post in waiting)
        {
            // Held to the same bar as a fresh draft: read against the live site, nothing to fix and no advice left.
            var check = await BlogPostChecking.CheckAsync(_db, _catalogue, post, ct);
            if (!check.CheckedAgainstSite || check.Blockers.Count > 0 || check.Advice.Count > 0)
                continue;
            if (post.ReviewNotes.Count > 0)
                post.ClearReviewNotes(_clock.UtcNow);
            PublishDraft(post, _clock.UtcNow);
            published++;
        }
        if (published > 0)
            await _db.SaveChangesAsync(ct);
        return published;
    }

    private void PublishDraft(BlogPost post, DateTime now)
    {
        post.Publish(now);
        BlogSiteChanges.RequestRebuild(_db, $"Gemini draft published: /blog/{post.Slug}", now);
        _logger.LogInformation("Published the Gemini draft {Slug}.", post.Slug);
    }

    /// <summary>
    /// Queues the scheduled batch when a slot (<see cref="BlogSettings.AutoDraftDays"/> at
    /// <see cref="BlogSettings.AutoDraftTimeUtc"/>) has come in the last <see cref="BlogSettings.AutoDraftGrace"/>
    /// and no scheduled batch was queued since. Returns the run queued, or null.
    /// </summary>
    public async Task<BlogGenerationRun?> QueueScheduledIfDueAsync(CancellationToken ct)
    {
        if (!_settings.AutoDraftEnabled || !_gemini.IsConfigured || _settings.AutoDraftDays.Count == 0)
            return null;
        var now = _clock.UtcNow;
        var slot = LatestSlot(now);
        if (slot is null || now - slot.Value > _settings.AutoDraftGrace)
            return null;
        var done = await _db.BlogGenerationRuns.AnyAsync(r => r.Trigger == BlogGenerationTrigger.Schedule && r.CreatedAtUtc >= slot.Value, ct);
        if (done)
            return null;

        var run = BlogGenerationRun.Queue(BlogGenerationTrigger.Schedule, Math.Clamp(_settings.AutoDraftCount, 1, BlogGenerationRun.MaxCount), null, null, null, now);
        _db.BlogGenerationRuns.Add(run);
        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("Queued the scheduled blog drafts for {Slot:u}.", slot);
        return run;
    }

    /// <summary>The most recent drafting slot at or before <paramref name="now"/> (looking back a week).</summary>
    public DateTime? LatestSlot(DateTime now)
    {
        for (var back = 0; back <= 7; back++)
        {
            var day = now.Date.AddDays(-back);
            var at = day + _settings.AutoDraftTimeUtc.ToTimeSpan();
            if (at <= now && _settings.AutoDraftDays.Contains(day.DayOfWeek))
                return DateTime.SpecifyKind(at, DateTimeKind.Utc);
        }
        return null;
    }

    /// <summary>Runs the oldest queued batch to the end. Returns false when there was none.</summary>
    public async Task<bool> RunNextAsync(CancellationToken ct)
    {
        var run = await _db.BlogGenerationRuns
            .Where(r => r.Status == BlogGenerationStatus.Queued)
            .OrderBy(r => r.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);
        if (run is null)
            return false;
        try
        {
            await RunAsync(run, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Blog drafting batch {Run} failed.", run.Id);
            if (!run.IsFinished)
                await FinishAsync(run, "Something went wrong while drafting; the drafts saved before it are kept.", CancellationToken.None);
        }
        return true;
    }

    private async Task RunAsync(BlogGenerationRun run, CancellationToken ct)
    {
        run.Start(_settings.GeminiModel, _clock.UtcNow);
        await _db.SaveChangesAsync(ct);

        if (!_gemini.IsConfigured)
        {
            await FinishAsync(run, GeminiErrors.NotConfigured.Message, ct);
            return;
        }

        var catalogue = await _catalogue.GetAsync(ct);
        if (catalogue.IsFailure)
        {
            await FinishAsync(run, $"Could not read the site's hymn catalogue ({catalogue.Error.Message}), so no solfa examples could be offered. Try again shortly.", ct);
            return;
        }

        var live = await LivePosts.ReadAsync(_db, ct);
        var takenSlugs = (await _db.BlogPosts.Select(p => p.Slug).ToListAsync(ct)).ToHashSet(StringComparer.Ordinal);
        var (topics, problem) = await PickTopicsAsync(run, takenSlugs, ct);
        if (topics.Count == 0)
        {
            await FinishAsync(run, problem ?? "Every topic in the queue has a post. Add topics to keep drafting.", ct);
            return;
        }

        string? stopped = null;
        foreach (var topic in topics)
        {
            ct.ThrowIfCancellationRequested();
            if (_health.IsUnavailable(OutboundProviders.Gemini))
            {
                // Our breaker opened after repeated failures: every call would be refused unsent.
                stopped = GeminiErrors.BreakerOpen.Message;
                break;
            }
            var outcome = await _writer.WriteAsync(topic, catalogue.Value, live, takenSlugs, ct);
            if (outcome.Draft is null)
            {
                run.Add(new BlogGenerationItem(topic.Slug, topic.Keyword, topic.TopicId, null, null, false, outcome.Problems,
                    outcome.Error?.Message ?? "The model did not return a usable post.", outcome.Usage, outcome.Model));
                await _db.SaveChangesAsync(ct);
                if (outcome.Error is { } e)
                {
                    // No answer even after one more try (or a bad key, an unknown model, an open breaker): the rest
                    // of the batch would fail the same way, and each try costs.
                    stopped = e.Message;
                    break;
                }
                continue;
            }

            var post = SaveDraft(topic, outcome);
            takenSlugs.Add(post.Slug);
            var passed = outcome.Problems.Count == 0 && outcome.Error is null;
            if (passed && _settings.AutoPublishDrafts)
                PublishDraft(post, _clock.UtcNow);
            run.Add(new BlogGenerationItem(topic.Slug, topic.Keyword, topic.TopicId, post.Id, post.Title,
                passed, outcome.Problems, outcome.Error?.Message, outcome.Usage, outcome.Model));
            await _db.SaveChangesAsync(ct);
            _logger.LogInformation("Saved blog draft {Slug} ({Problems} problems left, {Tokens} tokens).",
                post.Slug, outcome.Problems.Count, outcome.Usage.Sum(u => u.Total));
        }

        await FinishAsync(run, stopped, ct);
    }

    private BlogPost SaveDraft(DraftTopic topic, DraftOutcome outcome)
    {
        var d = outcome.Draft!;
        var now = _clock.UtcNow;
        var content = new BlogPostContent(
            Title: Cap(d.Title.Length > 0 ? d.Title : topic.Keyword, BlogPost.TitleMaxLength),
            Dek: null,
            Description: Cap(d.Description, BlogPost.DescriptionMaxLength),
            Body: d.Body,
            Tags: d.Tags.Select(BlogPost.Slugify).Where(t => t.Length > 0 && t.Length <= BlogPost.TagMaxLength).Distinct().Take(BlogPost.MaxTags).ToList(),
            Keyword: Cap(topic.Keyword, BlogPost.KeywordMaxLength),
            CoverUrl: null, CoverAlt: null, CoverWidth: null, CoverHeight: null,
            Faq: d.Faq.Take(BlogPost.MaxFaq).ToList(),
            SeoTitle: null, SeoDescription: null,
            Author: BlogPost.DefaultAuthor);
        var post = BlogPost.Create(topic.Slug, content, BlogPostSource.Gemini, now);
        var notes = outcome.Problems.ToList();
        if (outcome.Error is { } error)
            notes.Insert(0, $"The revision could not be fetched ({error.Message}); this is the first draft.");
        post.RecordGeneration(topic.TopicId, outcome.Model, outcome.Usage, notes);
        _db.BlogPosts.Add(post);

        if (topic.TopicId is { } id && _db.BlogTopics.Local.FirstOrDefault(t => t.Id == id) is { } queued)
            queued.MarkUsed(post.Id, now);
        return post;
    }

    private async Task<(List<DraftTopic> Topics, string? Problem)> PickTopicsAsync(BlogGenerationRun run, HashSet<string> taken, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        if (run.TopicText is { } text)
        {
            var slug = BlogPost.Slugify(text);
            if (slug.Length == 0)
                return ([], "The topic has no letters or numbers to make a URL from.");
            var unique = slug;
            for (var n = 2; taken.Contains(unique); n++)
                unique = $"{slug}-{n}";
            return ([new DraftTopic(null, unique, text, "Written to the founder's own brief.", text, [])], null);
        }

        if (run.TopicId is { } topicId)
        {
            var topic = await _db.BlogTopics.FirstOrDefaultAsync(t => t.Id == topicId, ct);
            if (topic is null)
                return ([], "That topic is no longer in the queue.");
            if (taken.Contains(topic.Slug))
            {
                topic.MarkUsed(null, now);
                await _db.SaveChangesAsync(ct);
                return ([], $"A post with the slug \"{topic.Slug}\" already exists.");
            }
            return ([ToDraft(topic)], null);
        }

        var picked = new List<DraftTopic>();
        var candidates = await _db.BlogTopics
            .Where(t => t.Status == BlogTopicStatus.Unused)
            .OrderBy(t => t.Position).ThenBy(t => t.CreatedAtUtc)
            .ToListAsync(ct);
        foreach (var topic in candidates)
        {
            if (picked.Count == run.Count)
                break;
            if (taken.Contains(topic.Slug))
            {
                topic.MarkUsed(null, now); // a post already answers it
                continue;
            }
            picked.Add(ToDraft(topic));
        }
        await _db.SaveChangesAsync(ct);
        return (picked, null);
    }

    private static DraftTopic ToDraft(BlogTopic t) => new(t.Id, t.Slug, t.Keyword, t.Intent, t.Angle, t.Links);

    private async Task FinishAsync(BlogGenerationRun run, string? error, CancellationToken ct)
    {
        run.Finish(_clock.UtcNow, error);
        await _db.SaveChangesAsync(ct);
        if (error is not null)
            _logger.LogWarning("Blog drafting stopped: {Error}", error);
    }

    private static string Cap(string s, int max) => s.Length > max ? s[..max].TrimEnd() : s;
}

/// <summary>The live posts, for links, titles and the drafter's page list.</summary>
public static class LivePosts
{
    public static async Task<IReadOnlyList<LivePost>> ReadAsync(IApplicationDbContext db, CancellationToken ct, Guid? except = null)
    {
        var rows = await db.BlogPosts
            .Where(p => p.Status == BlogPostStatus.Published && (except == null || p.Id != except))
            .OrderByDescending(p => p.PublishedAtUtc)
            .Select(p => new { p.Slug, p.Title, p.Description, p.Tags })
            .ToListAsync(ct);
        return rows.Select(r => new LivePost(r.Slug, r.Title, r.Description, r.Tags)).ToList();
    }
}
