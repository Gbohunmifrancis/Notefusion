using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="AdminTrustedBrowser"/>: a browser the console remembers, gone with its account.</summary>
public sealed class AdminTrustedBrowserConfiguration : IEntityTypeConfiguration<AdminTrustedBrowser>
{
    public void Configure(EntityTypeBuilder<AdminTrustedBrowser> builder)
    {
        builder.ToTable("admin_trusted_browsers");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Id).ValueGeneratedNever();

        // Hex SHA-256: 64 characters.
        builder.Property(b => b.TokenHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(b => b.TokenHash).IsUnique();
        builder.Property(b => b.Label).HasMaxLength(AdminTrustedBrowser.LabelMaxLength).IsRequired();
        builder.Property(b => b.CreatedAtUtc).IsRequired();

        builder.HasOne<User>().WithMany().HasForeignKey(b => b.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(b => b.UserId);
    }
}
