using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="Transcription"/>. The <c>MusicalKey</c> value object is flattened into columns;
/// the note list is an owned collection (its own table). Solfa is never persisted — it is derived
/// from the note list and the key on render, so a key override is a pure re-label (F-03).
/// </summary>
public sealed class TranscriptionConfiguration : IEntityTypeConfiguration<Transcription>
{
    public void Configure(EntityTypeBuilder<Transcription> builder)
    {
        builder.ToTable("transcriptions");

        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).ValueGeneratedNever();

        builder.Property(t => t.UserId).IsRequired();
        builder.Property(t => t.Title).HasMaxLength(200).IsRequired();
        builder.Property(t => t.CreatedAtUtc).IsRequired();
        builder.Property(t => t.TempoBpm).IsRequired();
        builder.Property(t => t.TimeSignature).HasMaxLength(10).IsRequired();
        builder.Property(t => t.MusicXml).IsRequired();
        builder.Property(t => t.OverallConfidence).IsRequired();
        builder.Property(t => t.SourceJobId).HasMaxLength(100);
        builder.Property(t => t.Status).HasConversion<string>().HasMaxLength(20).IsRequired();

        // Movable-do key as flattened columns on the same table.
        builder.OwnsOne(t => t.Key, key =>
        {
            key.Property(k => k.TonicPitchClass).HasColumnName("key_tonic_pitch_class").IsRequired();
            key.Property(k => k.Mode).HasColumnName("key_mode").HasConversion<string>().HasMaxLength(10).IsRequired();
            key.Property(k => k.Confidence).HasColumnName("key_confidence").IsRequired();
        });
        builder.Navigation(t => t.Key).IsRequired();

        // The note list is the source of truth for both notation views; store it as an owned collection.
        builder.OwnsMany(t => t.Notes, notes =>
        {
            notes.ToTable("transcription_notes");
            notes.WithOwner().HasForeignKey("TranscriptionId");
            notes.Property<int>("Id");
            notes.HasKey("Id");
            notes.Property(n => n.PitchMidi).IsRequired();
            notes.Property(n => n.StartBeat).IsRequired();
            notes.Property(n => n.DurationBeats).IsRequired();
            notes.Property(n => n.Confidence).IsRequired();
        });
        builder.Navigation(t => t.Notes).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
