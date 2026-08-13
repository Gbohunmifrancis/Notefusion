using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Infrastructure.Persistence.Configurations.Billing;

/// <summary>
/// Maps <see cref="WebhookEvent"/> — the inbox. The unique <c>(Provider, ProviderEventId)</c> index is
/// what makes processing exactly-once: a replayed delivery collides on insert and is recognised as a
/// duplicate. Indexed on <c>Status</c> so the worker can cheaply find undrained rows.
/// </summary>
public sealed class WebhookEventConfiguration : IEntityTypeConfiguration<WebhookEvent>
{
    public void Configure(EntityTypeBuilder<WebhookEvent> builder)
    {
        builder.ToTable("webhook_events");

        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();

        builder.Property(e => e.Provider).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(e => e.ProviderEventId).HasMaxLength(200).IsRequired();
        builder.Property(e => e.EventType).HasMaxLength(100).IsRequired();
        builder.Property(e => e.PaymentReference).HasMaxLength(100);
        builder.Property(e => e.Payload).IsRequired();
        builder.Property(e => e.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(e => e.ProcessAttempts).IsRequired();
        builder.Property(e => e.LastError).HasMaxLength(1000);
        builder.Property(e => e.ReceivedAtUtc).IsRequired();
        builder.Property(e => e.LastAttemptAtUtc);
        builder.Property(e => e.ProcessedAtUtc);

        builder.HasIndex(e => new { e.Provider, e.ProviderEventId }).IsUnique();
        builder.HasIndex(e => e.Status);
    }
}
