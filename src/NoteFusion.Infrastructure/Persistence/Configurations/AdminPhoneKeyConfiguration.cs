using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="AdminPhoneKey"/>: a phone's key to Admin, gone with its account like its passkeys.</summary>
public sealed class AdminPhoneKeyConfiguration : IEntityTypeConfiguration<AdminPhoneKey>
{
    public void Configure(EntityTypeBuilder<AdminPhoneKey> builder)
    {
        builder.ToTable("admin_phone_keys");
        builder.HasKey(k => k.Id);
        builder.Property(k => k.Id).ValueGeneratedNever();

        // Hex SHA-256: 64 characters.
        builder.Property(k => k.SecretHash).HasMaxLength(64).IsRequired();
        builder.Property(k => k.Label).HasMaxLength(80).IsRequired();
        builder.Property(k => k.CreatedAtUtc).IsRequired();

        builder.HasOne<User>().WithMany().HasForeignKey(k => k.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(k => k.UserId);
    }
}
