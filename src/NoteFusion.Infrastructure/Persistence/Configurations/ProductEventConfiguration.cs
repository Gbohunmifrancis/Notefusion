using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

public sealed class ProductEventConfiguration : IEntityTypeConfiguration<ProductEvent>
{
    public void Configure(EntityTypeBuilder<ProductEvent> builder)
    {
        builder.ToTable("product_events");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();
        builder.Property(e => e.Name).HasMaxLength(48).IsRequired();
        builder.Property(e => e.Surface).HasMaxLength(32).IsRequired();
        builder.Property(e => e.AnonymousId).HasMaxLength(128);
        builder.Property(e => e.JobId).HasMaxLength(100);
        builder.Property(e => e.MetadataJson).HasMaxLength(2048);
        builder.Property(e => e.OccurredAtUtc).IsRequired();
        builder.HasIndex(e => new { e.Name, e.OccurredAtUtc });
        builder.HasIndex(e => e.JobId);
    }
}
