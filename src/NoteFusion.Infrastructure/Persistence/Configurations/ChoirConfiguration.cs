using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="Choir"/>: one per director (unique owner), found by its invite code (unique). Goes with
/// the director's account, and its members with it.
/// </summary>
public sealed class ChoirConfiguration : IEntityTypeConfiguration<Choir>
{
    public void Configure(EntityTypeBuilder<Choir> builder)
    {
        builder.ToTable("choirs");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Id).ValueGeneratedNever();

        builder.Property(c => c.Name).HasMaxLength(Choir.NameMaxLength).IsRequired();
        builder.Property(c => c.InviteCode).HasMaxLength(Choir.InviteCodeLength).IsRequired();
        builder.Property(c => c.Provider).HasConversion<string>().HasMaxLength(20);
        builder.Property(c => c.CurrentPeriodStartUtc).IsRequired();
        builder.Property(c => c.CurrentPeriodEndUtc).IsRequired();
        builder.Property(c => c.CreatedAtUtc).IsRequired();
        builder.Property(c => c.UpdatedAtUtc).IsRequired();

        // Two payments for one choir fulfilled at once must both stack (see PaymentFulfillment).
        builder.Property(c => c.Version).IsRequired().IsConcurrencyToken();

        builder.HasOne<User>().WithMany().HasForeignKey(c => c.OwnerId).OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(c => c.OwnerId).IsUnique();
        builder.HasIndex(c => c.InviteCode).IsUnique();
    }
}

/// <summary>
/// Maps <see cref="ChoirMember"/>. The unique index on the account is "one choir per account", held by the
/// database so two joins at once cannot both land.
/// </summary>
public sealed class ChoirMemberConfiguration : IEntityTypeConfiguration<ChoirMember>
{
    public void Configure(EntityTypeBuilder<ChoirMember> builder)
    {
        builder.ToTable("choir_members");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Id).ValueGeneratedNever();
        builder.Property(m => m.JoinedAtUtc).IsRequired();

        builder.HasOne<Choir>().WithMany().HasForeignKey(m => m.ChoirId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(m => m.UserId).IsUnique();
        builder.HasIndex(m => m.ChoirId);
    }
}
