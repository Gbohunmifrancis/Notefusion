using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="TrialDevice"/> — one row per handset that has spent a free generation. The unique index
/// is the point of the table: every submit from a free account looks its device up by fingerprint, and two
/// rows for one device would split an allowance that is supposed to be shared.
/// </summary>
public sealed class TrialDeviceConfiguration : IEntityTypeConfiguration<TrialDevice>
{
    public void Configure(EntityTypeBuilder<TrialDevice> builder)
    {
        builder.ToTable("trial_devices");

        builder.HasKey(d => d.Id);
        builder.Property(d => d.Id).ValueGeneratedNever();

        // 64 exactly: the value is SHA-256 hex, produced by RequestDeviceFingerprint.
        builder.Property(d => d.Fingerprint).HasMaxLength(64).IsRequired();
        builder.HasIndex(d => d.Fingerprint).IsUnique();

        builder.Property(d => d.FirstSeenAtUtc).IsRequired();
        builder.Property(d => d.LastSeenAtUtc).IsRequired();

        builder.Property(d => d.FirstSeenCountry).HasMaxLength(2);
        builder.Property(d => d.LastSeenCountry).HasMaxLength(2);

        // 45 is the longest an address can print: an IPv6 with an embedded IPv4 tail.
        builder.Property(d => d.FirstSeenIp).HasMaxLength(45);
    }
}
