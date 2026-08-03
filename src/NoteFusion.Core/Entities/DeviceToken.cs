using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A registered push device (expo push token) for a user. Push notifications for
/// transcription completion are delivered to all of a user's active devices (PRD §push).
/// </summary>
public class DeviceToken : BaseEntity
{
    private DeviceToken() { } // EF Core

    public Guid UserId { get; private set; }
    public string Token { get; private set; } = string.Empty;
    public string Platform { get; private set; } = "ios"; // "ios" | "android" | "web"
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }

    public static DeviceToken Create(Guid userId, string token, string platform, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            Token = Guard.NotNullOrWhiteSpace(token),
            Platform = Guard.NotNullOrWhiteSpace(platform),
            CreatedAt = utcNow,
            UpdatedAt = utcNow
        };

    public void Touch(DateTime utcNow) => UpdatedAt = utcNow;
}
