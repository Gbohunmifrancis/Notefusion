using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

public sealed class WebPreviewJobConfiguration : IEntityTypeConfiguration<WebPreviewJob>
{
    public void Configure(EntityTypeBuilder<WebPreviewJob> builder)
    {
        builder.ToTable("web_preview_jobs");
        builder.HasKey(j => j.Id);
        builder.Property(j => j.Id).ValueGeneratedNever();
        builder.Property(j => j.JobId).HasMaxLength(100).IsRequired();
        builder.HasIndex(j => j.JobId).IsUnique();
        builder.Property(j => j.PreviewTokenHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(j => j.PreviewTokenHash).IsUnique();
        builder.Property(j => j.DeviceFingerprint).HasMaxLength(64);
        builder.HasIndex(j => new { j.DeviceFingerprint, j.CreatedAtUtc });
        builder.Property(j => j.CreatedAtUtc).IsRequired();
        builder.Property(j => j.ExpiresAtUtc).IsRequired();
        builder.HasIndex(j => j.ExpiresAtUtc);
        builder.Property(j => j.ResultJson);
        builder.Property(j => j.Error).HasMaxLength(1000);
    }
}
