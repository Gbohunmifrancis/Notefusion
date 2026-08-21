using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="AdminAuditLog"/>. No foreign keys to <c>users</c> on purpose: the trail has to outlive
/// the accounts it describes, and a cascade or a restrict would either delete history or block a deletion
/// the operator asked for. The emails are stored alongside the ids for exactly that reason.
/// </summary>
public sealed class AdminAuditLogConfiguration : IEntityTypeConfiguration<AdminAuditLog>
{
    public void Configure(EntityTypeBuilder<AdminAuditLog> builder)
    {
        builder.ToTable("admin_audit_logs");

        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever();

        builder.Property(a => a.ActorUserId).IsRequired();
        builder.Property(a => a.ActorEmail).HasMaxLength(254).IsRequired();
        builder.Property(a => a.Action).HasConversion<string>().HasMaxLength(40).IsRequired();
        builder.Property(a => a.TargetUserId);
        builder.Property(a => a.TargetEmail).HasMaxLength(254);
        // 45 covers the longest textual IPv6 form, including an IPv4-mapped tail.
        builder.Property(a => a.IpAddress).HasMaxLength(45);
        builder.Property(a => a.Summary).HasMaxLength(300).IsRequired();
        builder.Property(a => a.Note).HasMaxLength(500);
        builder.Property(a => a.OccurredAtUtc).IsRequired();

        // The log page is "newest first", so the ordering column is indexed on its own.
        builder.HasIndex(a => a.OccurredAtUtc);

        // An account's own history: filtered by target, still newest first.
        builder.HasIndex(a => new { a.TargetUserId, a.OccurredAtUtc });

        builder.HasIndex(a => a.Action);
    }
}
