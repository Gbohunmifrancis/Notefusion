using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>Maps <see cref="SupportConversation"/>: an account's thread goes with the account, a visitor's is found by its key.</summary>
public sealed class SupportConversationConfiguration : IEntityTypeConfiguration<SupportConversation>
{
    public void Configure(EntityTypeBuilder<SupportConversation> builder)
    {
        builder.ToTable("support_conversations");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Id).ValueGeneratedNever();
        builder.Property(c => c.VisitorKeyHash).HasMaxLength(64);
        builder.Property(c => c.Name).HasMaxLength(SupportConversation.NameMaxLength);
        builder.Property(c => c.Email).HasMaxLength(SupportConversation.EmailMaxLength);
        builder.Property(c => c.Source).HasMaxLength(10).IsRequired();
        builder.Property(c => c.Path).HasMaxLength(SupportConversation.PathMaxLength);
        builder.Ignore(c => c.IsClosed);
        builder.Ignore(c => c.UnreadByAdmin);

        builder.HasOne<User>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(c => c.UserId).IsUnique();
        builder.HasIndex(c => c.VisitorKeyHash).IsUnique();
        builder.HasIndex(c => c.LastMessageAtUtc);
    }
}

/// <summary>Maps <see cref="SupportMessage"/>: gone with its thread.</summary>
public sealed class SupportMessageConfiguration : IEntityTypeConfiguration<SupportMessage>
{
    public void Configure(EntityTypeBuilder<SupportMessage> builder)
    {
        builder.ToTable("support_messages");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Id).ValueGeneratedNever();
        builder.Property(m => m.Body).HasMaxLength(SupportMessage.BodyMaxLength).IsRequired();
        builder.Ignore(m => m.FromAdmin);
        builder.HasOne<SupportConversation>().WithMany().HasForeignKey(m => m.ConversationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(m => new { m.ConversationId, m.CreatedAtUtc });
    }
}
