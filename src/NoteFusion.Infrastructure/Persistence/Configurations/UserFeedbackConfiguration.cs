using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="UserFeedback"/>. Indexed for the prompts' "has this account answered?" and the console's newest-first lists.</summary>
public sealed class UserFeedbackConfiguration : IEntityTypeConfiguration<UserFeedback>
{
    public void Configure(EntityTypeBuilder<UserFeedback> builder)
    {
        builder.ToTable("user_feedback");
        builder.HasKey(f => f.Id);
        builder.Property(f => f.Id).ValueGeneratedNever();
        builder.Property(f => f.Kind).HasMaxLength(20).IsRequired();
        builder.Property(f => f.Category).HasMaxLength(UserFeedback.ShortMaxLength);
        builder.Property(f => f.Message).HasMaxLength(UserFeedback.MessageMaxLength);
        builder.Property(f => f.Client).HasMaxLength(10).IsRequired();
        builder.Property(f => f.AppVersion).HasMaxLength(UserFeedback.ShortMaxLength);
        builder.Property(f => f.Screen).HasMaxLength(UserFeedback.ShortMaxLength);
        builder.HasIndex(f => new { f.UserId, f.Kind, f.CreatedAtUtc });
        builder.HasIndex(f => new { f.Kind, f.CreatedAtUtc });
    }
}
