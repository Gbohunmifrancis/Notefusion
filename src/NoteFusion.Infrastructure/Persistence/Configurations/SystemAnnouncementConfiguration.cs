using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

public sealed class SystemAnnouncementConfiguration : IEntityTypeConfiguration<SystemAnnouncement>
{
    public void Configure(EntityTypeBuilder<SystemAnnouncement> builder)
    {
        builder.ToTable("system_announcements");

        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever();

        builder.Property(a => a.Message).HasMaxLength(1000).IsRequired();
        builder.Property(a => a.Severity).HasMaxLength(20).IsRequired();
        builder.Property(a => a.IsActive).IsRequired();
        builder.Property(a => a.ExpiresAtUtc);
        builder.Property(a => a.CreatedAtUtc).IsRequired();
        builder.Property(a => a.UpdatedAtUtc).IsRequired();

        builder.HasIndex(a => a.IsActive);
        builder.HasIndex(a => a.CreatedAtUtc);
    }
}
