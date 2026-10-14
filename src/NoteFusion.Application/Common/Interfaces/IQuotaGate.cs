namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Serialises the check → submit → record sequence of a metered request, one subject at a time. Every
/// allowance is counted from job rows, and a row is written only after the worker accepts the job, so
/// without this, parallel requests from one account could all count, all submit and all be recorded —
/// every one passing a gate that should have let one through.
/// </summary>
/// <remarks>
/// Hold the lease across the count, the worker submit and the <c>SaveChangesAsync</c> that records the
/// job; nothing outside that window is protected. Keys name the subject being metered:
/// <c>user:{id}</c> for a signed-in account, <c>device:{fingerprint}</c> and <c>ip:{address}</c> for an
/// anonymous preview. Take several keys with <see cref="QuotaGateExtensions.AcquireAllAsync"/>, which
/// orders them, so two requests can never each hold a key the other is waiting on.
/// </remarks>
public interface IQuotaGate
{
    /// <summary>Waits until no other request holds <paramref name="key"/>; disposing the lease releases it.</summary>
    Task<IAsyncDisposable> AcquireAsync(string key, CancellationToken ct = default);
}

public static class QuotaGateExtensions
{
    /// <summary>The key for a signed-in account's allowances.</summary>
    public static string UserKey(Guid userId) => $"user:{userId}";

    /// <summary>
    /// Takes every non-null key in ordinal order, so overlapping sets cannot deadlock, and hands back one
    /// lease that releases them all.
    /// </summary>
    public static async Task<IAsyncDisposable> AcquireAllAsync(
        this IQuotaGate gate, IEnumerable<string?> keys, CancellationToken ct = default)
    {
        var ordered = keys.OfType<string>().Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();
        var held = new Leases();
        try
        {
            foreach (var key in ordered)
                held.Add(await gate.AcquireAsync(key, ct));
        }
        catch
        {
            await held.DisposeAsync();
            throw;
        }
        return held;
    }

    private sealed class Leases : IAsyncDisposable
    {
        private readonly List<IAsyncDisposable> _held = [];

        public void Add(IAsyncDisposable lease) => _held.Add(lease);

        public async ValueTask DisposeAsync()
        {
            for (var i = _held.Count - 1; i >= 0; i--)
                await _held[i].DisposeAsync();
            _held.Clear();
        }
    }
}
