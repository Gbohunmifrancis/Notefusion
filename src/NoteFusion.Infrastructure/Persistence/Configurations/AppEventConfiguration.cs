using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="AppEvent"/>. Indexed the way the console reads it: a name over a window, and an account's own.</summary>
public sealed class AppEventConfiguration : IEntityTypeConfiguration<AppEvent>
{
    public void Configure(EntityTypeBuilder<AppEvent> builder)
    {
        builder.ToTable("app_events");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();
        builder.Property(e => e.UserId).IsRequired();
        builder.Property(e => e.Name).HasMaxLength(AppEvent.NameMaxLength).IsRequired();
        builder.Property(e => e.Detail).HasMaxLength(AppEvent.DetailMaxLength);
        builder.Property(e => e.DeviceHash).HasMaxLength(AppEvent.DeviceHashMaxLength);
        builder.Property(e => e.AppBuild).IsRequired();
        builder.Property(e => e.OccurredAtUtc).IsRequired();
        builder.Property(e => e.ReceivedAtUtc).IsRequired();
        builder.HasIndex(e => new { e.Name, e.OccurredAtUtc });
        builder.HasIndex(e => new { e.UserId, e.OccurredAtUtc });
        builder.HasIndex(e => e.OccurredAtUtc);
        builder.Property(e => e.ClientId).HasMaxLength(ClientEventIds.MaxLength);
        builder.HasIndex(e => new { e.UserId, e.ClientId });
    }
}
