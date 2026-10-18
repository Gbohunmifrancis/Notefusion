using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One email the provider accepted, and what kind it was: the count the sending quota is read from (the
/// provider's plan caps mail per day and per month). No recipient and no content, only the kind and the time.
/// </summary>
public class EmailSend : BaseEntity
{
    private EmailSend() { } // EF Core

    public EmailKind Kind { get; private set; }

    public DateTime SentAtUtc { get; private set; }

    public static EmailSend Record(EmailKind kind, DateTime utcNow)
        => new() { Id = Guid.NewGuid(), Kind = kind, SentAtUtc = utcNow };
}
