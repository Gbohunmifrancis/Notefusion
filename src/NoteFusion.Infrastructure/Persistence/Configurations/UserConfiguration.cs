using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="User"/>. Email is normalized (trimmed, lowercase) at creation, so it can
/// serve as the natural unique key; ids are deterministic from the email (survive a DB reset).
/// </summary>
public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");

        builder.HasKey(u => u.Id);

        builder.Property(u => u.Id)
            .ValueGeneratedNever(); // deterministic (MD5 of email) — never let Postgres assign one

        builder.Property(u => u.FullName).HasMaxLength(100).IsRequired();
        builder.Property(u => u.Email).HasMaxLength(254).IsRequired();
        builder.Property(u => u.PhoneNumber).HasMaxLength(30);
        // Nullable: Google-created accounts have no password (see User.PasswordHash).
        builder.Property(u => u.PasswordHash).HasMaxLength(200);
        builder.Property(u => u.GoogleId).HasMaxLength(64);
        builder.Property(u => u.ProfilePictureUrl).HasMaxLength(500);
        // ISO 3166-1 alpha-2. Nullable, and null means "we do not know" — every account created before
        // countries were resolved is in that state, and so is anyone whose lookup failed.
        builder.Property(u => u.Country).HasMaxLength(2).IsFixedLength();
        builder.Property(u => u.SignupSource).HasColumnName("signup_source").HasMaxLength(10);
        builder.Property(u => u.Role).HasConversion<string>().HasMaxLength(20).IsRequired();
        // "Playful" / "Focused" by name; null until the singer picks one.
        builder.Property(u => u.PracticeTrack).HasConversion<string>().HasMaxLength(10);
        // The client's X-Time-Zone (IANA name or offset), as PracticeTime.Known accepts it; null reads as Lagos.
        builder.Property(u => u.TimeZone).HasMaxLength(64);
        builder.Property(u => u.CreatedAt).IsRequired();

        // SHA-256 hex — 64 characters, always. Nullable because most rows have no code outstanding:
        // one is issued at sign-up and destroyed the moment it is used.
        builder.Property(u => u.EmailVerificationCodeHash).HasMaxLength(64);

        builder.HasIndex(u => u.Email).IsUnique();

        // The inbox the address delivers to, which the free allowance is shared across. Deliberately NOT
        // unique: accounts made before it existed may already share an inbox, and both must keep working.
        builder.Property(u => u.CanonicalEmail).HasMaxLength(254);
        builder.HasIndex(u => u.CanonicalEmail);

        // Filtered unique index: one account per Google subject, while the many
        // password-only users (all null) stay exempt from the uniqueness rule.
        builder.HasIndex(u => u.GoogleId)
            .IsUnique()
            .HasFilter("\"GoogleId\" IS NOT NULL");

        // Cascade delete is intentional: a user's refresh tokens and push devices are
        // useless (and a liability) once the account is gone.
        builder.HasMany(u => u.RefreshTokens)
            .WithOne()
            .HasForeignKey(t => t.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(u => u.DeviceTokens)
            .WithOne()
            .HasForeignKey(t => t.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Transcriptions have no navigation on User (queried by UserId in handlers);
        // the relationship + cascade is declared from the dependent side in its own config.
    }
}
