using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="TranscriptionJob"/>. Every index here exists for a query on a hot path: the unique
/// one because every poll looks a job up by its ML id, the composite one because every submit counts
/// how much of the caller's free allowance is gone, and the filtered one because the completion sweep
/// runs every few seconds.
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

        // Song credits are counted per account per month, over link jobs only.
        builder.Property(j => j.Kind).HasDefaultValue(Core.Enums.TranscriptionJobKind.Upload);
        builder.Property(j => j.WasPro).HasDefaultValue(false);
        builder.HasIndex(j => new { j.UserId, j.Kind, j.SongCreditConsumedAtUtc });

        // 64 exactly: SHA-256 hex out of RequestDeviceFingerprint. Indexed alongside the trial column for
        // the same reason the pair above is — the submit gate counts by device on every free submission.
        builder.Property(j => j.DeviceFingerprint).HasMaxLength(64);
        builder.HasIndex(j => new { j.DeviceFingerprint, j.TrialConsumedAtUtc });

        // Unbounded: a transcription of a long recording is a few hundred KB of MusicXML and note
        // data, and there is no sensible cap to impose that the ML service does not already impose.
        builder.Property(j => j.ResultJson);

        // Filtered so the index holds only open jobs — a handful at any moment — rather than a row
        // for every transcription ever run. The sweep's predicate is exactly this filter plus an age
        // cutoff on CreatedAtUtc, which is why that column is the one indexed under it.
        builder.HasIndex(j => j.CreatedAtUtc)
            .HasFilter("\"SettledAtUtc\" IS NULL");
    }
}
