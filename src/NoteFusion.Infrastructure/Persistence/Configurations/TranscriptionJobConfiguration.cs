using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="TranscriptionJob"/>. Both indexes exist for a query on the hot path: the unique
/// one because every poll looks a job up by its ML id, the composite one because every submit counts
/// how much of the caller's free allowance is gone.
/// </summary>
public sealed class TranscriptionJobConfiguration : IEntityTypeConfiguration<TranscriptionJob>
{
    public void Configure(EntityTypeBuilder<TranscriptionJob> builder)
    {
        builder.ToTable("transcription_jobs");

        builder.HasKey(j => j.Id);
        builder.Property(j => j.Id).ValueGeneratedNever();

        // 100 chars matches Transcription.SourceJobId, which stores the same value.
        builder.Property(j => j.JobId).HasMaxLength(100).IsRequired();
        builder.HasIndex(j => j.JobId).IsUnique();

        builder.Property(j => j.UserId).IsRequired();
        builder.Property(j => j.CreatedAtUtc).IsRequired();

        builder.HasIndex(j => new { j.UserId, j.TrialConsumedAtUtc });
    }
}
