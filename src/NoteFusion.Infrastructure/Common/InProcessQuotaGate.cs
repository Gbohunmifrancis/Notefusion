using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Common;

/// <summary>
/// <see cref="IQuotaGate"/> for one API process: a <see cref="SemaphoreSlim"/> per key, created on first use
/// and dropped when its last holder or waiter leaves, so the table only holds keys in use right now.
/// </summary>
/// <remarks>
/// This assumes a single API instance, which is how production runs (one container). A second instance
/// would have its own table and could let a parallel request through; scaling out needs the lock moved
/// into the database instead — a Postgres advisory lock on a hash of the key (<c>pg_advisory_xact_lock</c>)
/// taken in the transaction that records the job.
/// </remarks>
public sealed class InProcessQuotaGate : IQuotaGate
{
    private readonly Dictionary<string, Entry> _entries = new(StringComparer.Ordinal);
    private readonly Lock _sync = new();

    public async Task<IAsyncDisposable> AcquireAsync(string key, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);

        Entry? entry;
        lock (_sync)
        {
            if (!_entries.TryGetValue(key, out entry))
            {
                entry = new Entry();
                _entries[key] = entry;
            }
            entry.RefCount++;
        }

        try
        {
            await entry.Semaphore.WaitAsync(ct);
        }
        catch
        {
            Leave(key, entry, held: false);
            throw;
        }

        return new Lease(this, key, entry);
    }

    /// <summary>How many keys are held or waited on right now. Zero when idle: nothing is kept per key.</summary>
    public int ActiveKeys
    {
        get
        {
            lock (_sync)
                return _entries.Count;
        }
    }

    private void Leave(string key, Entry entry, bool held)
    {
        if (held)
            entry.Semaphore.Release();
        lock (_sync)
        {
            if (--entry.RefCount == 0)
            {
                _entries.Remove(key);
                entry.Semaphore.Dispose();
            }
        }
    }

    private sealed class Entry
    {
        public SemaphoreSlim Semaphore { get; } = new(1, 1);
        public int RefCount;
    }

    private sealed class Lease(InProcessQuotaGate gate, string key, Entry entry) : IAsyncDisposable
    {
        private int _released;

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
                gate.Leave(key, entry, held: true);
            return ValueTask.CompletedTask;
        }
    }
}
