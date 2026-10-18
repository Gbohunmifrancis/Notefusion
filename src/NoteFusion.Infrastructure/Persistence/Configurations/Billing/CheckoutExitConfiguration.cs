using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Infrastructure.Persistence.Configurations.Billing;

/// <summary>
/// Maps <see cref="CheckoutExit"/>. The unique transaction index is what makes it one row per checkout: the return
/// is recorded the first time and the answer at most once. Rows go with the account (cascade), unlike the payment
/// rows they sit beside, and with the payment row when one is purged.
/// </summary>
public sealed class CheckoutExitConfiguration : IEntityTypeConfiguration<CheckoutExit>
{
    public void Configure(EntityTypeBuilder<CheckoutExit> builder)
    {
        builder.ToTable("checkout_exits");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();

        builder.Property(e => e.Reason).HasConversion<string>().HasMaxLength(20);
        builder.Property(e => e.Note).HasMaxLength(CheckoutExit.NoteMaxLength);

        builder.HasOne<PaymentTransaction>().WithMany().HasForeignKey(e => e.PaymentTransactionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(e => e.PaymentTransactionId).IsUnique();
        builder.HasIndex(e => e.UserId);
        // The console reads the latest "Something else" notes.
        builder.HasIndex(e => e.AnsweredAtUtc);
    }
}
