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

    /// <summary>
    /// The account this preview was handed to, once someone signed up or signed in to keep it. Null for a
    /// preview nobody claimed, which is the state most of them stay in until they expire.
    /// </summary>
    public Guid? ClaimedByUserId { get; private set; }

    public DateTime? ClaimedAtUtc { get; private set; }

    /// <summary>The library row the claim produced, so a repeated claim returns the same one.</summary>
    public Guid? ClaimedTranscriptionId { get; private set; }

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

    /// <summary>
    /// Hands this preview to an account. Returns false when it already belongs to a different one, which is
    /// what stops a leaked preview token from moving someone else's result into a stranger's library.
    /// </summary>
    /// <remarks>
    /// Re-claiming by the same owner succeeds without changing anything, so a retried request — a flaky
    /// network on the sign-up screen, say — settles on the transcription the first call already created
    /// instead of making a second copy of it.
    /// </remarks>
    public bool Claim(Guid userId, Guid transcriptionId, DateTime now)
    {
        if (ClaimedByUserId is { } owner)
            return owner == userId;

        ClaimedByUserId = userId;
        ClaimedTranscriptionId = transcriptionId;
        ClaimedAtUtc = now;
        return true;
    }
}
