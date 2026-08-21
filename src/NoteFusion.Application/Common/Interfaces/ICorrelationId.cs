namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// The identifier tying together everything one caller's request touched, or null when there is no request
/// in flight (a background worker, a test).
/// </summary>
/// <remarks>
/// Exists so that work crossing a process boundary can carry it. A transcription is a three-hop story — the
/// app posts, this API forwards, the Python worker infers on a thread pool minutes later — and without a
/// shared value the three logs cannot be joined, which is why "a job failed" was previously unanswerable
/// past "which job". Read-only: the value is minted at the edge, in
/// <c>CorrelationIdMiddleware</c>, and nothing downstream gets to choose its own.
/// </remarks>
public interface ICorrelationId
{
    string? Current { get; }
}
