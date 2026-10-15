using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="OutreachMessage"/>. The unique (user, segment, channel) index is the claim that makes a
/// research message "once per segment, ever" even when two sweeps overlap: the second insert fails.
/// Rows go with the account (cascade), like its device tokens.
/// </summary>
public sealed class OutreachMessageConfiguration : IEntityTypeConfiguration<OutreachMessage>
{
    public void Configure(EntityTypeBuilder<OutreachMessage> builder)
    {
        builder.ToTable("outreach_messages");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Id).ValueGeneratedNever();

        builder.Property(m => m.Segment).HasConversion<string>().HasMaxLength(32).IsRequired();
        builder.Property(m => m.Channel).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(m => m.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(m => m.Error).HasMaxLength(OutreachMessage.ErrorMaxLength);

        builder.HasOne<User>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(m => new { m.UserId, m.Segment, m.Channel }).IsUnique();
        // The admin list and the activity feed read newest first.
        builder.HasIndex(m => m.CreatedAtUtc);
    }
}

/// <summary>Maps <see cref="EmailOptOut"/>: at most one per account, gone with the account.</summary>
public sealed class EmailOptOutConfiguration : IEntityTypeConfiguration<EmailOptOut>
{
    public void Configure(EntityTypeBuilder<EmailOptOut> builder)
    {
        builder.ToTable("email_opt_outs");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.Id).ValueGeneratedNever();

        builder.HasOne<User>().WithMany().HasForeignKey(o => o.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(o => o.UserId).IsUnique();
    }
}
