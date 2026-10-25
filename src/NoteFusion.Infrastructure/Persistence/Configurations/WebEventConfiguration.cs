using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="WebEvent"/>. Indexed the way the dashboard reads it: by time, by kind and time, and by account.</summary>
public sealed class WebEventConfiguration : IEntityTypeConfiguration<WebEvent>
{
    public void Configure(EntityTypeBuilder<WebEvent> builder)
    {
        builder.ToTable("web_events");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();
        builder.Property(e => e.Kind).HasMaxLength(10).IsRequired();
        builder.Property(e => e.Name).HasMaxLength(WebEvent.NameMaxLength);
        builder.Property(e => e.Path).HasMaxLength(WebEvent.PathMaxLength).IsRequired();
        builder.Property(e => e.Target).HasMaxLength(WebEvent.TargetMaxLength);
        builder.Property(e => e.Referrer).HasMaxLength(WebEvent.ReferrerMaxLength);
        builder.Property(e => e.VisitorId).HasMaxLength(WebEvent.IdMaxLength).IsRequired();
        builder.Property(e => e.SessionId).HasMaxLength(WebEvent.IdMaxLength).IsRequired();
        builder.Property(e => e.Detail).HasMaxLength(WebEvent.DetailMaxLength);
        builder.Property(e => e.DeviceHash).HasMaxLength(WebEvent.IdMaxLength);
        builder.Property(e => e.Device).HasMaxLength(10).IsRequired();
        builder.Property(e => e.OccurredAtUtc).IsRequired();
        builder.HasIndex(e => e.OccurredAtUtc);
        builder.HasIndex(e => new { e.Kind, e.OccurredAtUtc });
        builder.HasIndex(e => new { e.UserId, e.OccurredAtUtc });
        builder.HasIndex(e => new { e.VisitorId, e.OccurredAtUtc });
        builder.HasIndex(e => new { e.DeviceHash, e.OccurredAtUtc });
        builder.Property(e => e.ClientId).HasMaxLength(ClientEventIds.MaxLength);
        builder.HasIndex(e => new { e.VisitorId, e.ClientId });
        builder.Property(e => e.UtmSource).HasMaxLength(WebEvent.CampaignMaxLength);
        builder.Property(e => e.UtmMedium).HasMaxLength(WebEvent.CampaignMaxLength);
        builder.Property(e => e.UtmCampaign).HasMaxLength(WebEvent.CampaignNameMaxLength);
        builder.Property(e => e.UtmTerm).HasMaxLength(WebEvent.CampaignNameMaxLength);
        builder.Property(e => e.UtmContent).HasMaxLength(WebEvent.CampaignNameMaxLength);
        builder.Property(e => e.Ref).HasMaxLength(WebEvent.CampaignMaxLength);
        builder.Property(e => e.Country).HasMaxLength(2);
        builder.Property(e => e.Browser).HasMaxLength(WebEvent.FamilyMaxLength);
        builder.Property(e => e.Os).HasMaxLength(WebEvent.FamilyMaxLength);
    }
}
