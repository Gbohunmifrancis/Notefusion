using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps <see cref="EmailSend"/>. No link to an account: the quota counts the mail whoever it went to, and
/// after the account is gone. Indexed by time, the only way the quota reads it.
/// </summary>
public sealed class EmailSendConfiguration : IEntityTypeConfiguration<EmailSend>
{
    public void Configure(EntityTypeBuilder<EmailSend> builder)
    {
        builder.ToTable("email_sends");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.Kind).HasConversion<string>().HasMaxLength(32).IsRequired();
        builder.HasIndex(s => s.SentAtUtc);
    }
}
