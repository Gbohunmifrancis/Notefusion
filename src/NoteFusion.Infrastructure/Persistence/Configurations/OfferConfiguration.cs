using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="Offer"/>: one row per seasonal offer, its key unique (the email's link and the checkout name it). No
/// foreign key to the admins who made or sent it: like the audit log, the row keeps their email and outlives them.
/// </summary>
public sealed class OfferConfiguration : IEntityTypeConfiguration<Offer>
{
    public void Configure(EntityTypeBuilder<Offer> builder)
    {
        builder.ToTable("offers");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.Id).ValueGeneratedNever();

        builder.Property(o => o.Key).HasMaxLength(Offer.KeyMaxLength).IsRequired();
        builder.Property(o => o.Name).HasMaxLength(Offer.NameMaxLength).IsRequired();
        builder.Property(o => o.Template).HasMaxLength(Offer.TemplateMaxLength).IsRequired();
        builder.Property(o => o.Subject).HasMaxLength(Offer.SubjectMaxLength).IsRequired();
        builder.Property(o => o.Preheader).HasMaxLength(Offer.PreheaderMaxLength).IsRequired();
        builder.Property(o => o.Headline).HasMaxLength(Offer.HeadlineMaxLength).IsRequired();
        builder.Property(o => o.Body).HasMaxLength(Offer.BodyMaxLength).IsRequired();
        builder.Property(o => o.LastCallSubject).HasMaxLength(Offer.SubjectMaxLength);
        builder.Property(o => o.LastCallPreheader).HasMaxLength(Offer.PreheaderMaxLength);
        builder.Property(o => o.LastCallHeadline).HasMaxLength(Offer.HeadlineMaxLength);
        builder.Property(o => o.LastCallBody).HasMaxLength(Offer.BodyMaxLength);
        builder.Property(o => o.CreatedByEmail).HasMaxLength(Offer.EmailMaxLength);

        builder.Ignore(o => o.WordsLocked);
        builder.Ignore(o => o.EarliestEndUtc);
        builder.Ignore(o => o.LatestEndUtc);

        builder.HasIndex(o => o.Key).IsUnique();
    }
}

/// <summary>
/// Maps <see cref="OfferEmail"/>. Unique (offer, account, round): one launch email and one last call per person per
/// offer, so a second Send pressed at the same moment fails its insert. The token is unique (the click looks it up). Rows go with the account
/// (cascade), like its outreach messages, and with the offer.
/// </summary>
public sealed class OfferEmailConfiguration : IEntityTypeConfiguration<OfferEmail>
{
    public void Configure(EntityTypeBuilder<OfferEmail> builder)
    {
        builder.ToTable("offer_emails");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();

        builder.Property(e => e.Group).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(e => e.Round).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(e => e.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(e => e.SkipReason).HasConversion<string>().HasMaxLength(24);
        builder.Property(e => e.Token).HasMaxLength(OfferEmail.TokenMaxLength).IsRequired();
        builder.Property(e => e.LastError).HasMaxLength(OfferEmail.ErrorMaxLength);

        builder.HasOne<Offer>().WithMany().HasForeignKey(e => e.OfferId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(e => new { e.OfferId, e.UserId, e.Round }).IsUnique();
        builder.HasIndex(e => e.Token).IsUnique();
        // The worker reads an offer's queue; the progress counts read it by status.
        builder.HasIndex(e => new { e.OfferId, e.Status });
    }
}
