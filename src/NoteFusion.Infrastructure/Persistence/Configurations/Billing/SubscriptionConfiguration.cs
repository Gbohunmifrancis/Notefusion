using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Infrastructure.Persistence.Configurations.Billing;

/// <summary>
/// Maps <see cref="Subscription"/>. One current row per user, so <c>UserId</c> is uniquely indexed;
/// the status and period window gate Pro features. <c>IsActiveAt</c> is computed, never persisted.
/// </summary>
public sealed class SubscriptionConfiguration : IEntityTypeConfiguration<Subscription>
{
    public void Configure(EntityTypeBuilder<Subscription> builder)
    {
        builder.ToTable("subscriptions");

        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();

        builder.Property(s => s.UserId).IsRequired();
        builder.Property(s => s.PlanId).IsRequired();
        builder.Property(s => s.Provider).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(s => s.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(s => s.CurrentPeriodStartUtc).IsRequired();
        builder.Property(s => s.CurrentPeriodEndUtc).IsRequired();
        builder.Property(s => s.ProviderSubscriptionRef).HasMaxLength(200);
        builder.Property(s => s.CanceledAtUtc);
        builder.Property(s => s.CreatedAtUtc).IsRequired();
        builder.Property(s => s.UpdatedAtUtc).IsRequired();

        builder.HasIndex(s => s.UserId).IsUnique();
    }
}
