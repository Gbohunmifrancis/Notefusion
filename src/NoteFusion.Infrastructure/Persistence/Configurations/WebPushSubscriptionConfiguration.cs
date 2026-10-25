using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="WebPushSubscription"/>: one row per browser endpoint, gone with its account.</summary>
public sealed class WebPushSubscriptionConfiguration : IEntityTypeConfiguration<WebPushSubscription>
{
    public void Configure(EntityTypeBuilder<WebPushSubscription> builder)
    {
        builder.ToTable("web_push_subscriptions");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.Endpoint).HasMaxLength(WebPushSubscription.EndpointMaxLength).IsRequired();
        builder.Property(s => s.P256dh).HasMaxLength(WebPushSubscription.KeyMaxLength).IsRequired();
        builder.Property(s => s.Auth).HasMaxLength(WebPushSubscription.KeyMaxLength).IsRequired();
        builder.Property(s => s.UserAgent).HasMaxLength(WebPushSubscription.UserAgentMaxLength);
        builder.Property(s => s.CreatedAtUtc).IsRequired();
        builder.Property(s => s.UpdatedAtUtc).IsRequired();
        builder.Property(s => s.FailureCount).IsRequired();

        builder.HasIndex(s => s.Endpoint).IsUnique();
        builder.Property(s => s.Audience).HasMaxLength(10).IsRequired().HasDefaultValue(WebPushSubscription.AppAudience);
        builder.HasIndex(s => s.UserId);

        builder.HasOne<User>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
