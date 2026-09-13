using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

public sealed class WaitlistEntryConfiguration : IEntityTypeConfiguration<WaitlistEntry>
{
    public void Configure(EntityTypeBuilder<WaitlistEntry> builder)
    {
        builder.ToTable("waitlist_entries");

        builder.HasKey(w => w.Id);
        builder.Property(w => w.Id).ValueGeneratedNever();

        builder.Property(w => w.Email).HasMaxLength(254).IsRequired();
        builder.Property(w => w.FullName).HasMaxLength(150);
        builder.Property(w => w.Role).HasMaxLength(100);
        builder.Property(w => w.Source).HasMaxLength(100);
        builder.Property(w => w.CreatedAtUtc).IsRequired();
        builder.Property(w => w.IsInvited).IsRequired();
        builder.Property(w => w.InvitedAtUtc);

        builder.HasIndex(w => w.Email).IsUnique();
        builder.HasIndex(w => w.CreatedAtUtc);
    }
}
