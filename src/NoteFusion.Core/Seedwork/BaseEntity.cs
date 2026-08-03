namespace NoteFusion.Core.Seedwork;

/// <summary>
/// Root of all persisted entities. Ids are UUID v4 generated on the device — the library
/// is local-first (no account in MVP), and client-generated ids survive a future cloud sync.
/// </summary>
public abstract class BaseEntity
{
    public Guid Id { get; protected set; } = Guid.NewGuid();
}
