using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="PracticeSession"/>: graded practice, gone with its account, read per user and day.</summary>
public sealed class PracticeSessionConfiguration : IEntityTypeConfiguration<PracticeSession>
{
    public void Configure(EntityTypeBuilder<PracticeSession> builder)
    {
        builder.ToTable("practice_sessions");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.Kind).IsRequired();
        builder.Property(s => s.Part).HasMaxLength(1);
        builder.Property(s => s.DrillId).HasMaxLength(PracticeSession.DrillIdMaxLength);
        builder.Property(s => s.CreatedAtUtc).IsRequired();
        builder.Property(s => s.LocalDate).IsRequired();

        // The daily drill count and every progress read: one user's rows, by day.
        builder.HasIndex(s => new { s.UserId, s.LocalDate });

        builder.HasOne<User>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>Maps <see cref="Achievement"/>: one row per badge per account, held unique by the database.</summary>
public sealed class AchievementConfiguration : IEntityTypeConfiguration<Achievement>
{
    public void Configure(EntityTypeBuilder<Achievement> builder)
    {
        builder.ToTable("achievements");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever();
        builder.Property(a => a.Code).HasMaxLength(Achievement.CodeMaxLength).IsRequired();
        builder.Property(a => a.AwardedAtUtc).IsRequired();

        builder.HasIndex(a => new { a.UserId, a.Code }).IsUnique();

        builder.HasOne<User>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
