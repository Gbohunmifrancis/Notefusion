using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="BackupRun"/>. The backup container inserts with plain SQL (ops/backup/scripts/nf-backup-lib.sh,
/// nf_record), so the column names here are part of that script's contract.
/// </summary>
public sealed class BackupRunConfiguration : IEntityTypeConfiguration<BackupRun>
{
    public void Configure(EntityTypeBuilder<BackupRun> builder)
    {
        builder.ToTable("backup_runs");
        builder.HasKey(r => r.Id);
        // An identity column: the script's INSERT leaves the id to the database.
        builder.Property(r => r.Id).ValueGeneratedOnAdd();
        builder.Property(r => r.Kind).HasMaxLength(BackupRun.KindMaxLength).IsRequired();
        builder.Property(r => r.Ok).IsRequired();
        builder.Property(r => r.StartedAtUtc).IsRequired();
        builder.Property(r => r.FinishedAtUtc).IsRequired();
        builder.Property(r => r.Verified).IsRequired();
        builder.Property(r => r.Detail).HasMaxLength(BackupRun.DetailMaxLength);

        // "The latest dump", "the latest successful dump": every read is by kind, newest first.
        builder.HasIndex(r => new { r.Kind, r.FinishedAtUtc });
    }
}
