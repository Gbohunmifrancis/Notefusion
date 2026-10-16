using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Lists stored whole as one JSON text column: read and written with their row, never queried into.</summary>
internal static class JsonColumn
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static PropertyBuilder<List<T>> AsJson<T>(this PropertyBuilder<List<T>> property, string column)
        => property
            .HasColumnName(column)
            .HasConversion(
                v => JsonSerializer.Serialize(v, Options),
                v => JsonSerializer.Deserialize<List<T>>(v, Options) ?? new List<T>(),
                new ValueComparer<List<T>>(
                    (a, b) => JsonSerializer.Serialize(a, Options) == JsonSerializer.Serialize(b, Options),
                    v => JsonSerializer.Serialize(v, Options).GetHashCode(),
                    v => JsonSerializer.Deserialize<List<T>>(JsonSerializer.Serialize(v, Options), Options)!))
            .IsRequired();
}

/// <summary>
/// Maps <see cref="BlogPost"/>. The slug is unique (it is the URL); the published endpoint and the scheduled
/// sweep read by status, the admin list newest first.
/// </summary>
public sealed class BlogPostConfiguration : IEntityTypeConfiguration<BlogPost>
{
    public void Configure(EntityTypeBuilder<BlogPost> builder)
    {
        builder.ToTable("blog_posts");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).ValueGeneratedNever();

        builder.Property(p => p.Slug).HasMaxLength(BlogPost.SlugMaxLength).IsRequired();
        builder.Property(p => p.Title).HasMaxLength(BlogPost.TitleMaxLength).IsRequired();
        builder.Property(p => p.Dek).HasMaxLength(BlogPost.DekMaxLength);
        builder.Property(p => p.Description).HasMaxLength(BlogPost.DescriptionMaxLength).IsRequired();
        builder.Property(p => p.Body).IsRequired();
        builder.Property(p => p.Keyword).HasMaxLength(BlogPost.KeywordMaxLength);
        builder.Property(p => p.CoverUrl).HasMaxLength(BlogPost.CoverUrlMaxLength);
        builder.Property(p => p.CoverAlt).HasMaxLength(BlogPost.CoverAltMaxLength);
        builder.Property(p => p.SeoTitle).HasMaxLength(BlogPost.SeoTitleMaxLength);
        builder.Property(p => p.SeoDescription).HasMaxLength(BlogPost.SeoDescriptionMaxLength);
        builder.Property(p => p.Author).HasMaxLength(BlogPost.AuthorMaxLength).IsRequired();
        builder.Property(p => p.GenerationModel).HasMaxLength(BlogPost.ModelMaxLength);
        builder.Property(p => p.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(p => p.Source).HasConversion<string>().HasMaxLength(16).IsRequired();

        builder.Property(p => p.Tags).AsJson("tags_json");
        builder.Property(p => p.Faq).AsJson("faq_json");
        builder.Property(p => p.GenerationUsage).AsJson("generation_usage_json");
        builder.Property(p => p.ReviewNotes).AsJson("review_notes_json");

        builder.Ignore(p => p.IsLive);
        builder.Ignore(p => p.SlugLocked);
        builder.Ignore(p => p.CanPublish);
        builder.Ignore(p => p.CanSchedule);
        builder.Ignore(p => p.CanUnpublish);
        builder.Ignore(p => p.CanArchive);
        builder.Ignore(p => p.CanDelete);

        builder.HasIndex(p => p.Slug).IsUnique();
        builder.HasIndex(p => new { p.Status, p.PublishAtUtc });
        builder.HasIndex(p => p.UpdatedAtUtc);
    }
}

/// <summary>Maps <see cref="BlogTopic"/>: unique by slug, read in queue order.</summary>
public sealed class BlogTopicConfiguration : IEntityTypeConfiguration<BlogTopic>
{
    public void Configure(EntityTypeBuilder<BlogTopic> builder)
    {
        builder.ToTable("blog_topics");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).ValueGeneratedNever();

        builder.Property(t => t.Slug).HasMaxLength(BlogPost.SlugMaxLength).IsRequired();
        builder.Property(t => t.Keyword).HasMaxLength(BlogTopic.KeywordMaxLength).IsRequired();
        builder.Property(t => t.Intent).HasMaxLength(BlogTopic.IntentMaxLength).IsRequired();
        builder.Property(t => t.Angle).HasMaxLength(BlogTopic.AngleMaxLength).IsRequired();
        builder.Property(t => t.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(t => t.Links).AsJson("links_json");

        // A deleted draft frees its topic's link rather than blocking the delete.
        builder.HasOne<BlogPost>().WithMany().HasForeignKey(t => t.PostId).OnDelete(DeleteBehavior.SetNull);

        builder.HasIndex(t => t.Slug).IsUnique();
        builder.HasIndex(t => new { t.Status, t.Position });
    }
}

/// <summary>Maps <see cref="BlogGenerationRun"/>: the batch's drafts as one JSON column, newest first.</summary>
public sealed class BlogGenerationRunConfiguration : IEntityTypeConfiguration<BlogGenerationRun>
{
    public void Configure(EntityTypeBuilder<BlogGenerationRun> builder)
    {
        builder.ToTable("blog_generation_runs");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Id).ValueGeneratedNever();

        builder.Property(r => r.Trigger).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(r => r.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(r => r.TopicText).HasMaxLength(BlogGenerationRun.TopicTextMaxLength);
        builder.Property(r => r.Model).HasMaxLength(BlogPost.ModelMaxLength);
        builder.Property(r => r.Error).HasMaxLength(BlogGenerationRun.ErrorMaxLength);
        builder.Property(r => r.Items).AsJson("items_json");
        builder.Ignore(r => r.TotalTokens);
        builder.Ignore(r => r.IsFinished);

        builder.HasIndex(r => new { r.Status, r.CreatedAtUtc });
        builder.HasIndex(r => new { r.Trigger, r.CreatedAtUtc });
    }
}

/// <summary>Maps <see cref="BlogSiteRebuild"/>: the worker reads the pending ones and the newest dispatch.</summary>
public sealed class BlogSiteRebuildConfiguration : IEntityTypeConfiguration<BlogSiteRebuild>
{
    public void Configure(EntityTypeBuilder<BlogSiteRebuild> builder)
    {
        builder.ToTable("blog_site_rebuilds");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Id).ValueGeneratedNever();

        builder.Property(r => r.Reason).HasMaxLength(BlogSiteRebuild.ReasonMaxLength).IsRequired();
        builder.Property(r => r.Error).HasMaxLength(BlogSiteRebuild.ErrorMaxLength);

        builder.HasIndex(r => r.DispatchedAtUtc);
        builder.HasIndex(r => r.RequestedAtUtc);
    }
}
