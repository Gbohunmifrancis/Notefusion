using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="PreviewJob"/>. Indexed the two ways it is read: by job id on every poll, and by device and day for the throttle.</summary>
public sealed class PreviewJobConfiguration : IEntityTypeConfiguration<PreviewJob>
{
    public void Configure(EntityTypeBuilder<PreviewJob> builder)
    {
        builder.ToTable("preview_jobs");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).ValueGeneratedNever();
        builder.Property(p => p.JobId).HasMaxLength(100).IsRequired();
        builder.HasIndex(p => p.JobId).IsUnique();
        builder.Property(p => p.Kind).HasMaxLength(10).IsRequired();
        builder.Property(p => p.DeviceFingerprint).HasMaxLength(64);
        builder.HasIndex(p => new { p.DeviceFingerprint, p.CreatedAtUtc });
        builder.Property(p => p.Ip).HasMaxLength(45);
        builder.HasIndex(p => new { p.Ip, p.CreatedAtUtc });
        builder.Property(p => p.CreatedAtUtc).IsRequired();
        builder.Property(p => p.SourceTitle).HasMaxLength(300);
        builder.HasIndex(p => p.ClaimedByUserId);
    }
}
