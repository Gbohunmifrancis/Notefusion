using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Infrastructure.Persistence.Configurations.Billing;

/// <summary>
/// Maps <see cref="AdminPaymentAlert"/>. The unique payment id is the claim that makes the admins' payment push once
/// per payment, whoever fulfils it and however often. Gone with the payment.
/// </summary>
public sealed class AdminPaymentAlertConfiguration : IEntityTypeConfiguration<AdminPaymentAlert>
{
    public void Configure(EntityTypeBuilder<AdminPaymentAlert> builder)
    {
        builder.ToTable("admin_payment_alerts");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever();

        builder.Property(a => a.CreatedAtUtc).IsRequired();
        builder.Property(a => a.Error).HasMaxLength(AdminPaymentAlert.ErrorMaxLength);

        builder.HasOne<PaymentTransaction>()
            .WithMany()
            .HasForeignKey(a => a.PaymentTransactionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(a => a.PaymentTransactionId).IsUnique();
        // The sender's due list (unsent, recent) and the Push panel's last alert and day of refusals.
        builder.HasIndex(a => new { a.SentAtUtc, a.CreatedAtUtc });
        builder.HasIndex(a => a.CreatedAtUtc);
    }
}
