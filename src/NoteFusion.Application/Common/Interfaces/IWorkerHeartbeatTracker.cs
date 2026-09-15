namespace NoteFusion.Application.Common.Interfaces;

public sealed record WorkerHeartbeatRecord(
    string WorkerName,
    DateTime LastRunUtc,
    long DurationMs,
    string Status,
    string? Detail);

public interface IWorkerHeartbeatTracker
{
    void RecordHeartbeat(string workerName, long durationMs, string status = "Healthy", string? detail = null);
    IReadOnlyList<WorkerHeartbeatRecord> GetAll();
}
