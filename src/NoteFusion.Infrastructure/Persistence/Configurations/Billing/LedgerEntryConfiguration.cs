using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Infrastructure.Persistence.Configurations.Billing;

/// <summary>
/// Maps <see cref="LedgerEntry"/> — append-only. There is deliberately no unique/mutable balance
/// column: balances are summed from these rows. Indexed by user for balance queries, and uniquely by
/// (transaction, reason) so a payment is credited exactly once. <c>SignedAmountMinor</c> is computed
/// and never persisted.
/// </summary>
public sealed class LedgerEntryConfiguration : IEntityTypeConfiguration<LedgerEntry>
{
    public void Configure(EntityTypeBuilder<LedgerEntry> builder)
    {
        builder.ToTable("ledger_entries");

        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();

        builder.Property(e => e.UserId).IsRequired();
        builder.Property(e => e.PaymentTransactionId).IsRequired();
        builder.Property(e => e.Direction).HasConversion<string>().HasMaxLength(10).IsRequired();
        builder.Property(e => e.Reason).HasConversion<string>().HasMaxLength(30).IsRequired();
        builder.Property(e => e.AmountMinor).IsRequired();
        builder.Property(e => e.Currency).HasMaxLength(3).IsRequired();
        builder.Property(e => e.Description).HasMaxLength(200).IsRequired();
        builder.Property(e => e.CreatedAtUtc).IsRequired();

        builder.Ignore(e => e.SignedAmountMinor);

        builder.HasIndex(e => e.UserId);

        // Money-safety invariant: at most one ledger entry per (transaction, reason). A verified payment
        // yields exactly one SubscriptionCharge credit, so this unique index is the authoritative guard
        // that two racing fulfilment paths — overlapping webhook workers, or a webhook racing the
        // reconciliation sweep — can never double-credit: the second insert violates uniqueness and rolls
        // back. The leading column still serves lookups by transaction.
        builder.HasIndex(e => new { e.PaymentTransactionId, e.Reason }).IsUnique();
    }
}
