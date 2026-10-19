using System.Threading.Channels;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Transcriptions;

/// <summary>
/// <see cref="IJobEvents"/> in memory, for the one API instance. Each watcher gets a small queue of its own that keeps
/// the newest events when a slow reader falls behind (a progress bar only needs the latest), and the number of
/// streams one watcher, and the server, may hold open is capped so they cannot be used to exhaust it.
/// </summary>
public sealed class InMemoryJobEvents : IJobEvents
{
    /// <summary>Streams one account (or one address, for previews) may hold open at once: a few jobs on a few devices.</summary>
    public const int PerWatcher = 8;

    /// <summary>Streams the server holds open at once.</summary>
    public const int Total = 2000;

    /// <summary>Events a watcher's queue holds before the oldest are dropped.</summary>
    private const int Backlog = 16;

    private readonly object _lock = new();
    private readonly Dictionary<string, List<(Channel<JobEvent> Channel, bool Away)>> _byJob = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _byWatcher = new(StringComparer.Ordinal);
    private int _open;

    public JobWatch? Watch(string jobId, string watcher, bool away = false)
    {
        var channel = Channel.CreateBounded<JobEvent>(
            new BoundedChannelOptions(Backlog) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
        lock (_lock)
        {
            var held = _byWatcher.GetValueOrDefault(watcher);
            if (held >= PerWatcher || _open >= Total)
                return null;
            _byWatcher[watcher] = held + 1;
            _open++;
            if (!_byJob.TryGetValue(jobId, out var watchers))
                _byJob[jobId] = watchers = [];
            watchers.Add((channel, away));
        }
        return new JobWatch(channel.Reader, () => End(jobId, watcher, channel));
    }

    public bool IsWatched(string jobId)
    {
        lock (_lock)
            return _byJob.ContainsKey(jobId);
    }

    public int Publish(string jobId, JobEvent jobEvent)
    {
        (Channel<JobEvent> Channel, bool Away)[] watchers;
        lock (_lock)
        {
            if (!_byJob.TryGetValue(jobId, out var list))
                return 0;
            watchers = [.. list];
        }
        foreach (var (channel, _) in watchers)
            channel.Writer.TryWrite(jobEvent);
        return watchers.Count(w => !w.Away);
    }

    private void End(string jobId, string watcher, Channel<JobEvent> channel)
    {
        lock (_lock)
        {
            if (_byJob.TryGetValue(jobId, out var watchers) && watchers.RemoveAll(w => w.Channel == channel) > 0
                && watchers.Count == 0)
                _byJob.Remove(jobId);
            if (_byWatcher.TryGetValue(watcher, out var held))
            {
                if (held <= 1) _byWatcher.Remove(watcher);
                else _byWatcher[watcher] = held - 1;
            }
            _open--;
        }
        channel.Writer.TryComplete();
    }
}
