using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One person's thread with NoteFusion's support (the chat widget on the website, the web app and the phone). A
/// signed-in person has one thread, tied to their account; a website visitor's is tied to a random key their browser
/// keeps (only its SHA-256 here), with the name and email they chose to leave. A closed thread opens again when they
/// write. The admin console answers it live.
/// </summary>
public class SupportConversation : BaseEntity
{
    public const int NameMaxLength = 80;
    public const int EmailMaxLength = 200;
    public const int PathMaxLength = 200;

    public const string FromSite = "site";
    public const string FromWebApp = "web";
    public const string FromPhone = "app";

    private SupportConversation() { } // EF Core

    /// <summary>The account, when the person was signed in; null for a website visitor.</summary>
    public Guid? UserId { get; private set; }

    /// <summary>Hex SHA-256 of a visitor's key; null for an account's thread.</summary>
    public string? VisitorKeyHash { get; private set; }

    /// <summary>What a visitor called themselves; an account's thread shows the account's name instead.</summary>
    public string? Name { get; private set; }

    /// <summary>Where a visitor asked to be answered if they have left.</summary>
    public string? Email { get; private set; }

    /// <summary><see cref="FromSite"/>, <see cref="FromWebApp"/> or <see cref="FromPhone"/>: where the last message came from.</summary>
    public string Source { get; private set; } = FromSite;

    /// <summary>The page or screen the last message was sent from.</summary>
    public string? Path { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime LastMessageAtUtc { get; private set; }
    public DateTime? LastCustomerMessageAtUtc { get; private set; }
    public DateTime? AdminReadAtUtc { get; private set; }
    public DateTime? CustomerReadAtUtc { get; private set; }
    public DateTime? ClosedAtUtc { get; private set; }

    public bool IsClosed => ClosedAtUtc is not null;

    /// <summary>Something the customer wrote that no admin has opened since.</summary>
    public bool UnreadByAdmin => LastCustomerMessageAtUtc is { } at && (AdminReadAtUtc is null || AdminReadAtUtc < at);

    public static SupportConversation ForAccount(Guid userId, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            CreatedAtUtc = utcNow,
            LastMessageAtUtc = utcNow,
        };

    public static SupportConversation ForVisitor(string visitorKeyHash, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            VisitorKeyHash = Guard.NotNullOrWhiteSpace(visitorKeyHash),
            CreatedAtUtc = utcNow,
            LastMessageAtUtc = utcNow,
        };

    /// <summary>The customer wrote: the thread is open again and unread in the console.</summary>
    public void CustomerWrote(string source, string? path, string? name, string? email, DateTime utcNow)
    {
        Source = source is FromWebApp or FromPhone ? source : FromSite;
        Path = Clip(path, PathMaxLength);
        if (UserId is null)
        {
            Name = Clip(name, NameMaxLength) ?? Name;
            Email = Clip(email, EmailMaxLength)?.ToLowerInvariant() ?? Email;
        }
        LastMessageAtUtc = utcNow;
        LastCustomerMessageAtUtc = utcNow;
        CustomerReadAtUtc = utcNow;
        ClosedAtUtc = null;
    }

    public void AdminWrote(DateTime utcNow)
    {
        LastMessageAtUtc = utcNow;
        AdminReadAtUtc = utcNow;
    }

    public void ReadByAdmin(DateTime utcNow) => AdminReadAtUtc = utcNow;

    public void ReadByCustomer(DateTime utcNow) => CustomerReadAtUtc = utcNow;

    public void Close(DateTime utcNow) => ClosedAtUtc ??= utcNow;

    public void Reopen() => ClosedAtUtc = null;

    private static string? Clip(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        value = value.Trim();
        return value.Length <= max ? value : value[..max];
    }
}

/// <summary>One message in a <see cref="SupportConversation"/>: the customer's, or an admin's answer.</summary>
public class SupportMessage : BaseEntity
{
    public const int BodyMaxLength = 2000;

    private SupportMessage() { } // EF Core

    public Guid ConversationId { get; private set; }

    /// <summary>The admin who answered; null for the customer's own message.</summary>
    public Guid? AdminId { get; private set; }

    public bool FromAdmin => AdminId is not null;

    public string Body { get; private set; } = string.Empty;

    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Null for an empty message; a long one is cut at <see cref="BodyMaxLength"/>.</summary>
    public static SupportMessage? Create(Guid conversationId, Guid? adminId, string? body, DateTime utcNow)
    {
        var text = body?.Trim();
        if (string.IsNullOrEmpty(text))
            return null;
        return new SupportMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = Guard.AgainstEmpty(conversationId),
            AdminId = adminId,
            Body = text.Length <= BodyMaxLength ? text : text[..BodyMaxLength],
            CreatedAtUtc = utcNow,
        };
    }
}
