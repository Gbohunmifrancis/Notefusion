namespace NoteFusion.Core.Entities;

/// <summary>
/// Anonymous web-preview state. The raw browser token is never persisted; only its SHA-256 hash is stored.
/// </summary>
public sealed class WebPreviewJob
{
    private WebPreviewJob() { }

    public Guid Id { get; private set; }
    public string JobId { get; private set; } = null!;
    public string PreviewTokenHash { get; private set; } = null!;
    public string? DeviceFingerprint { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }
    public DateTime? SettledAtUtc { get; private set; }
    public string? ResultJson { get; private set; }
    public string? Error { get; private set; }

    public static WebPreviewJob Record(
        string jobId,
        string previewTokenHash,
        string? deviceFingerprint,
        DateTime createdAtUtc,
        DateTime expiresAtUtc)
        => new()
        {
            Id = Guid.NewGuid(),
            JobId = jobId,
            PreviewTokenHash = previewTokenHash,
            DeviceFingerprint = deviceFingerprint,
            CreatedAtUtc = createdAtUtc,
            ExpiresAtUtc = expiresAtUtc
        };

    public bool IsExpired(DateTime now) => now >= ExpiresAtUtc;

    public void Settle(DateTime now, string? resultJson, string? error)
    {
        if (SettledAtUtc is not null)
            return;

        SettledAtUtc = now;
        ResultJson = resultJson;
        Error = error;
    }
}
