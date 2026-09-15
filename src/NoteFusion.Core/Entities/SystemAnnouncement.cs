using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A global announcement broadcast to client applications (maintenance notices, incident warnings, feature rollouts).
/// </summary>
public sealed class SystemAnnouncement : BaseEntity
{
    private SystemAnnouncement() { } // EF Core

    public string Message { get; private set; } = string.Empty;
    public string Severity { get; private set; } = "info"; // info, warning, critical
    public bool IsActive { get; private set; }
    public DateTime? ExpiresAtUtc { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    public static SystemAnnouncement Create(
        string message,
        string severity,
        DateTime? expiresAtUtc,
        DateTime utcNow)
    {
        return new SystemAnnouncement
        {
            Id = Guid.NewGuid(),
            Message = Guard.NotNullOrWhiteSpace(message),
            Severity = string.IsNullOrWhiteSpace(severity) ? "info" : severity.ToLowerInvariant(),
            IsActive = true,
            ExpiresAtUtc = expiresAtUtc,
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow
        };
    }

    public void Update(string message, string severity, bool isActive, DateTime? expiresAtUtc, DateTime utcNow)
    {
        Message = Guard.NotNullOrWhiteSpace(message);
        Severity = string.IsNullOrWhiteSpace(severity) ? "info" : severity.ToLowerInvariant();
        IsActive = isActive;
        ExpiresAtUtc = expiresAtUtc;
        UpdatedAtUtc = utcNow;
    }

    public void Deactivate(DateTime utcNow)
    {
        IsActive = false;
        UpdatedAtUtc = utcNow;
    }
}
