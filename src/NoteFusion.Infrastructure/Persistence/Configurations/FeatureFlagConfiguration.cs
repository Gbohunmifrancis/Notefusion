using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="FeatureFlag"/>: one row per key, held unique by the database, so two admins saving at once cannot
/// leave two answers to "is it Christmas?". No foreign key to the admin who changed it: like the audit log, the row
/// keeps their email and outlives their account.
/// </summary>
public sealed class FeatureFlagConfiguration : IEntityTypeConfiguration<FeatureFlag>
{
    public void Configure(EntityTypeBuilder<FeatureFlag> builder)
    {
        builder.ToTable("feature_flags");
        builder.HasKey(f => f.Id);
        builder.Property(f => f.Id).ValueGeneratedNever();
        builder.Property(f => f.Key).HasMaxLength(FeatureFlag.KeyMaxLength).IsRequired();
        builder.Property(f => f.Enabled).IsRequired();
        builder.Property(f => f.AdminPreview).IsRequired();
        builder.Property(f => f.UpdatedByEmail).HasMaxLength(FeatureFlag.EmailMaxLength);
        builder.Property(f => f.UpdatedAtUtc).IsRequired();

        builder.HasIndex(f => f.Key).IsUnique();
    }
}
