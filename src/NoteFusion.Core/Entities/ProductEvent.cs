namespace NoteFusion.Core.Entities;

/// <summary>
/// Bounded product-funnel event. This is operational telemetry, not a raw request dump.
/// </summary>
public sealed class ProductEvent
{
    private ProductEvent() { }

    public Guid Id { get; private set; }
    public string Name { get; private set; } = null!;
    public DateTime OccurredAtUtc { get; private set; }
    public string Surface { get; private set; } = null!;
    public string? AnonymousId { get; private set; }
    public string? JobId { get; private set; }
    public string? MetadataJson { get; private set; }

    public static ProductEvent Record(
        string name,
        DateTime occurredAtUtc,
        string surface,
        string? anonymousId,
        string? jobId,
        string? metadataJson)
        => new()
        {
            Id = Guid.NewGuid(),
            Name = name,
            OccurredAtUtc = occurredAtUtc,
            Surface = surface,
            AnonymousId = anonymousId,
            JobId = jobId,
            MetadataJson = metadataJson
        };
}
