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

/// <summary>
/// Maps <see cref="PracticeReminder"/>. The unique (user, local date, slot) index is the claim that keeps a day to
/// at most two reminders even when two sweeps overlap: the second insert fails. Gone with the account.
/// </summary>
public sealed class PracticeReminderConfiguration : IEntityTypeConfiguration<PracticeReminder>
{
    public void Configure(EntityTypeBuilder<PracticeReminder> builder)
    {
        builder.ToTable("practice_reminders");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Id).ValueGeneratedNever();

        builder.Property(r => r.LocalDate).IsRequired();
        builder.Property(r => r.Slot).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(r => r.Kind).HasConversion<string>().HasMaxLength(24).IsRequired();
        builder.Property(r => r.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(r => r.Title).HasMaxLength(PracticeReminder.TitleMaxLength).IsRequired();
        builder.Property(r => r.Body).HasMaxLength(PracticeReminder.BodyMaxLength).IsRequired();
        builder.Property(r => r.Error).HasMaxLength(PracticeReminder.ErrorMaxLength);
        builder.Property(r => r.CreatedAtUtc).IsRequired();

        builder.HasOne<User>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(r => new { r.UserId, r.LocalDate, r.Slot }).IsUnique();
        // The sweep reads the last two days' claims, the retry pass the recent failures, the console newest first.
        builder.HasIndex(r => r.LocalDate);
        builder.HasIndex(r => r.CreatedAtUtc);
    }
}
