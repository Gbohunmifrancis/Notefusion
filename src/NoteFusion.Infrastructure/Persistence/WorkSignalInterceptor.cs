using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NoteFusion.Application.Analytics;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Infrastructure.Common;

namespace NoteFusion.Infrastructure.Persistence;

/// <summary>
/// Tells whoever waits on a row the moment it is saved: rings the loop that works it (<see cref="WorkSignals"/>) and
/// tells the console's live notices (<see cref="AdminLiveFeed"/>). One place, whichever command wrote the row, so the
/// loops can sleep long between sweeps and still answer at once. Only after the save commits: rung any sooner, a loop
/// could look before the row is there.
/// </summary>
public sealed class WorkSignalInterceptor : SaveChangesInterceptor
{
    private static readonly ConditionalWeakTable<DbContext, Staged> Pending = new();

    private readonly WorkSignals _signals;
    private readonly IJobEvents _events;

    public WorkSignalInterceptor(WorkSignals signals, IJobEvents events)
    {
        _signals = signals;
        _events = events;
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Stage(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Stage(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Ring(eventData.Context);
        return result;
    }

    public override ValueTask<int> SavedChangesAsync(
        SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        Ring(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData)
    {
        if (eventData.Context is { } context)
            Pending.Remove(context);
    }

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        SaveChangesFailed(eventData);
        return Task.CompletedTask;
    }

    private static void Stage(DbContext? context)
    {
        if (context is null)
            return;
        var staged = new Staged();
        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.State != EntityState.Added)
                continue;
            switch (entry.Entity)
            {
                case WebhookEvent:
                    staged.Work.Add(Work.PaymentWebhooks);
                    break;
                case AdminPaymentAlert: // written with a payment's ledger credit: a payment went through
                    staged.Work.Add(Work.PaymentAlerts);
                    staged.Live = true;
                    break;
                case BlogGenerationRun:
                    staged.Work.Add(Work.BlogDrafts);
                    break;
                case User or TranscriptionJob or PreviewJob:
                    staged.Live = true;
                    break;
            }
        }
        if (staged.Work.Count > 0 || staged.Live)
            Pending.AddOrUpdate(context, staged);
        else
            Pending.Remove(context);
    }

    private void Ring(DbContext? context)
    {
        if (context is null || !Pending.TryGetValue(context, out var staged))
            return;
        Pending.Remove(context);
        foreach (var work in staged.Work)
            _signals.Ring(work);
        if (staged.Live)
            AdminLiveFeed.Tell(_events);
    }

    private sealed class Staged
    {
        public HashSet<Work> Work { get; } = [];
        public bool Live { get; set; }
    }
}
