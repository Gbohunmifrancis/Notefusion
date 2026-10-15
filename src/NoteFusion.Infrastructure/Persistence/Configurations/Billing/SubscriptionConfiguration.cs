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

        // Nullable on purpose: no provider means no gateway took money, which is how a gift granted from the
        // admin console is told apart from a sale. See Subscription.Provider.
        builder.Property(s => s.Provider).HasConversion<string>().HasMaxLength(20);
        builder.Property(s => s.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(s => s.CurrentPeriodStartUtc).IsRequired();
        builder.Property(s => s.CurrentPeriodEndUtc).IsRequired();
        builder.Property(s => s.ProviderSubscriptionRef).HasMaxLength(200);
        builder.Property(s => s.CanceledAtUtc);
        builder.Property(s => s.ExpiryNoticeSentForPeriodEndUtc);
        builder.Property(s => s.CreatedAtUtc).IsRequired();
        builder.Property(s => s.UpdatedAtUtc).IsRequired();

        // Optimistic concurrency: every save checks the row still has the version it was read at, so two
        // fulfilments extending one membership at once cannot both write from the same period end.
        builder.Property(s => s.Version).IsRequired().IsConcurrencyToken();

        builder.HasIndex(s => s.UserId).IsUnique();

        // The expiry sweep filters on status and period end together.
        builder.HasIndex(s => new { s.Status, s.CurrentPeriodEndUtc });
    }
}
