using System.Collections.Concurrent;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Web;

/// <summary>
/// <see cref="IWebPresence"/> in memory: the last heartbeat per browser, forgotten after <see cref="KeepFor"/> and capped at
/// <see cref="MaxBrowsers"/> (the oldest go first), so a flood of made-up ids cannot grow it without end.
/// </summary>
public sealed class InMemoryWebPresence : IWebPresence
{
    public static readonly TimeSpan KeepFor = TimeSpan.FromMinutes(10);
    public const int MaxBrowsers = 20_000;

    private readonly ConcurrentDictionary<string, WebPresenceEntry> _seen = new(StringComparer.Ordinal);

    public void Touch(string visitorId, string path, DateTime atUtc)
    {
        _seen[visitorId] = new WebPresenceEntry(visitorId, path, atUtc);
        if (_seen.Count > MaxBrowsers)
            Prune(atUtc);
    }

    public IReadOnlyList<WebPresenceEntry> Since(DateTime sinceUtc)
    {
        Prune(sinceUtc);
        return [.. _seen.Values.Where(e => e.AtUtc >= sinceUtc)];
    }

    private void Prune(DateTime nowUtc)
    {
        foreach (var (id, entry) in _seen)
            if (entry.AtUtc < nowUtc - KeepFor)
                _seen.TryRemove(id, out _);
        if (_seen.Count <= MaxBrowsers)
            return;
        foreach (var entry in _seen.Values.OrderBy(e => e.AtUtc).Take(_seen.Count - MaxBrowsers))
            _seen.TryRemove(entry.VisitorId, out _);
    }
}
