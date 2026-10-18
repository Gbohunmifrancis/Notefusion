using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Infrastructure.Persistence.Configurations.Billing;

/// <summary>
/// Maps <see cref="PaymentTransaction"/>. <c>Reference</c> is our own id sent to the provider and the
/// key a webhook maps back on, so it is uniquely indexed; <c>IdempotencyKey</c> dedupes retried
/// initiations. Raw provider payloads are kept verbatim as text for dispute/audit.
/// </summary>
public sealed class PaymentTransactionConfiguration : IEntityTypeConfiguration<PaymentTransaction>
{
    public void Configure(EntityTypeBuilder<PaymentTransaction> builder)
    {
        builder.ToTable("payment_transactions");

        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).ValueGeneratedNever();

        builder.Property(t => t.UserId).IsRequired();
        builder.Property(t => t.PlanId).IsRequired();
        builder.Property(t => t.Provider).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(t => t.IdempotencyKey).HasMaxLength(200).IsRequired();
        builder.Property(t => t.Reference).HasMaxLength(100).IsRequired();
        builder.Property(t => t.ProviderReference).HasMaxLength(200);
        builder.Property(t => t.AmountMinor).IsRequired();
        builder.Property(t => t.Currency).HasMaxLength(3).IsRequired();
        builder.Property(t => t.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(t => t.CheckoutUrl).HasMaxLength(2000);
        builder.Property(t => t.FailureReason).HasMaxLength(1000);
        builder.Property(t => t.InitiateRaw);
        builder.Property(t => t.VerifyRaw);
        builder.Property(t => t.CreatedAtUtc).IsRequired();
        builder.Property(t => t.UpdatedAtUtc).IsRequired();
        builder.Property(t => t.Client).HasConversion<string>().HasMaxLength(10).IsRequired();
        builder.Property(t => t.ProviderAttempt).HasConversion<string>().HasMaxLength(20);

        builder.Ignore(t => t.Money);

        builder.HasIndex(t => t.Reference).IsUnique();
        builder.HasIndex(t => t.IdempotencyKey).IsUnique();
        builder.HasIndex(t => new { t.UserId, t.Status });
    }
}
