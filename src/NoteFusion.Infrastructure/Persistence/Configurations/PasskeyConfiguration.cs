using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="Passkey"/>. The credential id is unique across every account (a sign-in finds the
/// passkey by it alone, since the browser offers discoverable credentials without an email), and rows go
/// with their account (cascade), like its device tokens.
/// </summary>
public sealed class PasskeyConfiguration : IEntityTypeConfiguration<Passkey>
{
    public void Configure(EntityTypeBuilder<Passkey> builder)
    {
        builder.ToTable("passkeys");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).ValueGeneratedNever();

        // WebAuthn caps a credential id at 1023 bytes; a COSE public key is a few hundred at most.
        builder.Property(p => p.CredentialId).HasMaxLength(1023).IsRequired();
        builder.Property(p => p.PublicKey).HasMaxLength(2048).IsRequired();
        builder.Property(p => p.SignCount).IsRequired();
        builder.Property(p => p.AaGuid).IsRequired();
        builder.Property(p => p.Transports).HasMaxLength(100);
        builder.Property(p => p.Name).HasMaxLength(Passkey.NameMaxLength).IsRequired();
        builder.Property(p => p.CreatedAtUtc).IsRequired();

        builder.HasOne<User>().WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(p => p.CredentialId).IsUnique();
        builder.HasIndex(p => p.UserId);
    }
}
