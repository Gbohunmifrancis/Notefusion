using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Infrastructure.Common;

/// <summary>The background loops woken the moment their work is saved, instead of looking for it every few seconds.</summary>
public enum Work
{
    /// <summary>A provider's webhook was stored (<see cref="WebhookEvent"/>): <c>PaymentWebhookWorker</c>.</summary>
    PaymentWebhooks,

    /// <summary>A payment staged the admins' alert (<see cref="AdminPaymentAlert"/>): <c>PaymentAlertWorker</c>.</summary>
    PaymentAlerts,

    /// <summary>A batch of blog drafts was asked for (<see cref="BlogGenerationRun"/>): <c>BlogDraftWorker</c>.</summary>
    BlogDrafts,
}

/// <summary>
/// Wakes a waiting loop when its work arrives (<see cref="WorkSignalInterceptor"/> rings it as the rows are saved), so
/// the loop can sleep for a long while in between and still answer at once. A ring while the loop is busy is kept, so
/// work saved mid-pass is picked up on the next one; several rings are one. One API instance, as the loops assume.
/// </summary>
public sealed class WorkSignals
{
    private readonly Dictionary<Work, SemaphoreSlim> _bells =
        Enum.GetValues<Work>().ToDictionary(w => w, _ => new SemaphoreSlim(0, 1));

    public void Ring(Work work)
    {
        var bell = _bells[work];
        try
        {
            if (bell.CurrentCount == 0)
                bell.Release();
        }
        catch (SemaphoreFullException)
        {
            // Rung twice at once: already ringing.
        }
    }

    /// <summary>Waits until <paramref name="work"/> is rung or <paramref name="idle"/> has passed; true when it was rung.</summary>
    public Task<bool> WaitAsync(Work work, TimeSpan idle, CancellationToken ct) => _bells[work].WaitAsync(idle, ct);

    /// <summary>A loop's wait between passes: until it is rung, or <paramref name="idle"/> with no bells (a test's worker).</summary>
    public static Task Between(WorkSignals? signals, Work work, TimeSpan idle, CancellationToken ct)
        => signals is null ? Task.Delay(idle, ct) : signals.WaitAsync(work, idle, ct);
}
