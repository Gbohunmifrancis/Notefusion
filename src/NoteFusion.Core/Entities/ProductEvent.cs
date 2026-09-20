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

    /// <summary>
    /// The account behind the event, when the caller was signed in. This is the join that turns a stream of
    /// anonymous browser events into a funnel: the same <see cref="AnonymousId"/> carries across sign-up, so
    /// a row with a user attached tells you which visitor became which account.
    /// </summary>
    public Guid? UserId { get; private set; }

    public static ProductEvent Record(
        string name,
        DateTime occurredAtUtc,
        string surface,
        string? anonymousId,
        string? jobId,
        string? metadataJson,
        Guid? userId = null)
        => new()
        {
            Id = Guid.NewGuid(),
            Name = name,
            OccurredAtUtc = occurredAtUtc,
            Surface = surface,
            AnonymousId = anonymousId,
            JobId = jobId,
            MetadataJson = metadataJson,
            UserId = userId
        };
}
