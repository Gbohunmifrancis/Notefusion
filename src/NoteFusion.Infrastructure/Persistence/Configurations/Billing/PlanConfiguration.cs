using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Infrastructure.Persistence.Configurations.Billing;

/// <summary>Maps <see cref="Plan"/>. Seeded, not user-created; <c>Code</c> is the stable natural key.</summary>
public sealed class PlanConfiguration : IEntityTypeConfiguration<Plan>
{
    public void Configure(EntityTypeBuilder<Plan> builder)
    {
        builder.ToTable("plans");

        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).ValueGeneratedNever();

        builder.Property(p => p.Code).HasMaxLength(50).IsRequired();
        builder.Property(p => p.Name).HasMaxLength(100).IsRequired();
        builder.Property(p => p.AmountMinor).IsRequired();
        builder.Property(p => p.Currency).HasMaxLength(3).IsRequired();
        builder.Property(p => p.Interval).HasConversion<string>().HasMaxLength(10).IsRequired();
        builder.Property(p => p.IsActive).IsRequired();

        builder.HasIndex(p => p.Code).IsUnique();
    }
}
