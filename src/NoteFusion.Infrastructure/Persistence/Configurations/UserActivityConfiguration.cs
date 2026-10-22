using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="UserActivity"/>. Indexed the way the console reads it: newest first, an account's own, a name over a window.</summary>
public sealed class UserActivityConfiguration : IEntityTypeConfiguration<UserActivity>
{
    public void Configure(EntityTypeBuilder<UserActivity> builder)
    {
        builder.ToTable("user_activities");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();
        builder.Property(e => e.UserId).IsRequired();
        builder.Property(e => e.Name).HasMaxLength(UserActivity.NameMaxLength).IsRequired();
        builder.Property(e => e.Detail).HasMaxLength(UserActivity.DetailMaxLength);
        builder.Property(e => e.Client).HasMaxLength(8);
        builder.Property(e => e.OccurredAtUtc).IsRequired();
        builder.HasIndex(e => e.OccurredAtUtc);
        builder.HasIndex(e => new { e.UserId, e.OccurredAtUtc });
        builder.HasIndex(e => new { e.Name, e.OccurredAtUtc });
    }
}
