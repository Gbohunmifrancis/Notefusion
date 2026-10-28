using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="TranscriptionLog"/>. Indexed the way the activity log reads it: newest first, by job, by account and by device.</summary>
public sealed class TranscriptionLogConfiguration : IEntityTypeConfiguration<TranscriptionLog>
{
    public void Configure(EntityTypeBuilder<TranscriptionLog> builder)
    {
        builder.ToTable("transcription_logs");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.Property(l => l.JobId).HasMaxLength(100);
        builder.Property(l => l.DeviceHash).HasMaxLength(64);
        builder.Property(l => l.Origin).HasMaxLength(10).IsRequired();
        builder.Property(l => l.Client).HasMaxLength(10).IsRequired();
        builder.Property(l => l.Kind).HasMaxLength(10).IsRequired();
        builder.Property(l => l.Mode).HasMaxLength(10).IsRequired();
        builder.Property(l => l.FileName).HasMaxLength(TranscriptionLog.FileNameMaxLength);
        builder.Property(l => l.ContentType).HasMaxLength(TranscriptionLog.ContentTypeMaxLength);
        builder.Property(l => l.LinkUrl).HasMaxLength(TranscriptionLog.UrlMaxLength);
        builder.Property(l => l.KeyRequested).HasMaxLength(40);
        builder.Property(l => l.TimeSignatureRequested).HasMaxLength(10);
        builder.Property(l => l.Status).HasMaxLength(10).IsRequired();
        builder.Property(l => l.FailureReason).HasMaxLength(TranscriptionLog.ReasonMaxLength);
        builder.Property(l => l.FailureStage).HasMaxLength(TranscriptionLog.StageMaxLength);
        builder.Property(l => l.FailureCode).HasMaxLength(TranscriptionLog.CodeMaxLength);
        builder.Property(l => l.DetectedKey).HasMaxLength(40);
        builder.Property(l => l.SongTitle).HasMaxLength(TranscriptionLog.TextMaxLength);
        builder.Property(l => l.SongArtist).HasMaxLength(TranscriptionLog.TextMaxLength);
        builder.HasIndex(l => l.CreatedAtUtc);
        builder.HasIndex(l => l.JobId);
        builder.HasIndex(l => new { l.UserId, l.CreatedAtUtc });
        builder.HasIndex(l => new { l.DeviceHash, l.CreatedAtUtc });
    }
}
