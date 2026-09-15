using System.Collections.Concurrent;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Common;

/// <summary>
/// In-memory thread-safe tracker for background workers, providing heartbeats for health checks.
/// </summary>
public sealed class WorkerHeartbeatTracker : IWorkerHeartbeatTracker
{
    private readonly ConcurrentDictionary<string, WorkerHeartbeatRecord> _heartbeats = new();
    private readonly IDateTimeProvider _clock;

    public WorkerHeartbeatTracker(IDateTimeProvider clock)
    {
        _clock = clock;
    }

    public void RecordHeartbeat(string workerName, long durationMs, string status = "Healthy", string? detail = null)
    {
        _heartbeats[workerName] = new WorkerHeartbeatRecord(
            workerName,
            _clock.UtcNow,
            durationMs,
            status,
            detail);
    }

    public IReadOnlyList<WorkerHeartbeatRecord> GetAll()
    {
        return _heartbeats.Values
            .OrderBy(h => h.WorkerName)
            .ToList();
    }
}
