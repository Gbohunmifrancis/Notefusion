using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="FolderShare"/>: one link per user and folder, found by its token.</summary>
public sealed class FolderShareConfiguration : IEntityTypeConfiguration<FolderShare>
{
    public void Configure(EntityTypeBuilder<FolderShare> builder)
    {
        builder.ToTable("folder_shares");
        builder.HasKey(f => f.Id);
        builder.Property(f => f.Id).ValueGeneratedNever();
        builder.Property(f => f.Folder).HasMaxLength(Transcription.FolderMaxLength).IsRequired();
        builder.Property(f => f.Token).HasMaxLength(64).IsRequired();
        builder.HasIndex(f => f.Token).IsUnique();
        builder.HasIndex(f => new { f.UserId, f.Folder }).IsUnique();
    }
}
