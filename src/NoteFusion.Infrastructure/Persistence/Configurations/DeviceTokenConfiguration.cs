using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="DeviceToken"/> — one row per expo push token per user.</summary>
public sealed class DeviceTokenConfiguration : IEntityTypeConfiguration<DeviceToken>
{
    public void Configure(EntityTypeBuilder<DeviceToken> builder)
    {
        builder.ToTable("device_tokens");

        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).ValueGeneratedNever();

        builder.Property(t => t.UserId).IsRequired();
        builder.Property(t => t.Token).HasMaxLength(200).IsRequired();
        builder.Property(t => t.Platform).HasMaxLength(10).IsRequired();
        builder.Property(t => t.CreatedAt).IsRequired();
        builder.Property(t => t.UpdatedAt).IsRequired();
        builder.Property(t => t.AppBuild).IsRequired();
        builder.Property(t => t.NotifiedBuild).IsRequired();

        // Payment alerts, set from an admin's phone. Existing rows take the entity's defaults in the migration
        // (sound "chime", vibrate and problem alerts on), written there rather than as database defaults here: a bool
        // with a database default of true would have EF leave a false out of an insert and store true.
        builder.Property(t => t.PaymentAlertSound).HasMaxLength(16).IsRequired();

        builder.HasIndex(t => new { t.UserId, t.Token }).IsUnique();

        // The update-notice sweep's whole predicate, so it does not table-scan device_tokens every
        // interval. Ordered build-then-notified because the first column is the selective one: once
        // a release has propagated, almost no row is still behind on AppBuild.
        builder.HasIndex(t => new { t.AppBuild, t.NotifiedBuild });
    }
}
