using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Infrastructure.Persistence.Configurations.Billing;

/// <summary>
/// Maps <see cref="GooglePlayPurchase"/>. The token is unique, which is what keeps one Google purchase on one
/// account; the account index serves the membership's "who bills it" read and the sync's live-token lookup. Gone
/// with the account.
/// </summary>
public sealed class GooglePlayPurchaseConfiguration : IEntityTypeConfiguration<GooglePlayPurchase>
{
    public void Configure(EntityTypeBuilder<GooglePlayPurchase> builder)
    {
        builder.ToTable("google_play_purchases");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).ValueGeneratedNever();

        builder.Property(p => p.PurchaseToken).HasMaxLength(GooglePlayPurchase.TokenMaxLength).IsRequired();
        builder.Property(p => p.ProductId).HasMaxLength(GooglePlayPurchase.ProductIdMaxLength).IsRequired();
        builder.Property(p => p.BasePlanId).HasMaxLength(GooglePlayPurchase.ProductIdMaxLength);
        builder.Property(p => p.State).HasMaxLength(GooglePlayPurchase.StateMaxLength).IsRequired();
        builder.Property(p => p.LatestOrderId).HasMaxLength(GooglePlayPurchase.OrderIdMaxLength);
        builder.Property(p => p.ReplacedByToken).HasMaxLength(GooglePlayPurchase.TokenMaxLength);
        builder.Property(p => p.CreatedAtUtc).IsRequired();
        builder.Property(p => p.UpdatedAtUtc).IsRequired();

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(p => p.PurchaseToken).IsUnique();
        builder.HasIndex(p => new { p.UserId, p.ProductId });
        // The sweep: unacknowledged, unconsumed and overdue tokens, oldest first.
        builder.HasIndex(p => p.UpdatedAtUtc);
    }
}
