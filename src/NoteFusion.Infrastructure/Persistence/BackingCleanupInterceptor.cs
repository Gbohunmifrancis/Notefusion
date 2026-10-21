using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence;

/// <summary>
/// A sheet's backing lives exactly as long as the sheet: whichever command deletes a <see cref="Transcription"/> (the
/// owner's delete, a Save replacing the filed copy, an account closing), its stored backing is deleted once that
/// delete commits; and a closed account's whole backing folder goes with the <see cref="User"/>, a file whose own
/// delete once failed included. One place, as <see cref="WorkSignalInterceptor"/> is for the loops, so no delete path
/// can forget it. A backing a Save hands over to the new copy (<see cref="Transcription.TakePlaybackFrom"/>) is no
/// longer the old row's, and stays.
/// </summary>
/// <remarks>
/// Only after the commit: a delete that rolls back keeps its sheet, and the sheet its backing. The store's calls are
/// best effort and bounded by its resilience pipeline; they are not tied to the request, so a client hanging up does
/// not leave the file behind.
/// </remarks>
public sealed class BackingCleanupInterceptor : SaveChangesInterceptor
{
    private static readonly ConditionalWeakTable<DbContext, Staged> Pending = new();

    private readonly IBackingStorage _storage;

    public BackingCleanupInterceptor(IBackingStorage storage) => _storage = storage;

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
        CleanAsync(eventData.Context).GetAwaiter().GetResult();
        return result;
    }

    public override async ValueTask<int> SavedChangesAsync(
        SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        await CleanAsync(eventData.Context);
        return result;
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
            if (entry.State != EntityState.Deleted)
                continue;
            switch (entry.Entity)
            {
                case Transcription { BackingKey: { } key } sheet:
                    staged.Sheets.Add((sheet.UserId, key));
                    break;
                case User user:
                    staged.Accounts.Add(user.Id);
                    break;
            }
        }
        if (staged.Sheets.Count > 0 || staged.Accounts.Count > 0)
            Pending.AddOrUpdate(context, staged);
        else
            Pending.Remove(context);
    }

    private async Task CleanAsync(DbContext? context)
    {
        if (context is null || !Pending.TryGetValue(context, out var staged))
            return;
        Pending.Remove(context);

        // A closed account's folder sweep takes its sheets' files with it.
        var keys = staged.Sheets.Where(s => !staged.Accounts.Contains(s.UserId)).Select(s => s.Key).ToList();
        if (keys.Count > 0)
            await _storage.DeleteAsync(keys, CancellationToken.None);
        foreach (var account in staged.Accounts)
            await _storage.DeleteAllForUserAsync(account, CancellationToken.None);
    }

    private sealed class Staged
    {
        public List<(Guid UserId, string Key)> Sheets { get; } = [];
        public HashSet<Guid> Accounts { get; } = [];
    }
}
