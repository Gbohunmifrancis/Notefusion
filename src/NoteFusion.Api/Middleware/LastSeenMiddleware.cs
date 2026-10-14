using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Middleware;

/// <summary>
/// Records when each signed-in account was last seen: any authenticated request — a page of the web
/// app, a job poll, the phone app opening — moves <c>User.LastSeenAtUtc</c> forward, which is what the
/// admin console's online dot and "last seen" read.
/// </summary>
/// <remarks>
/// <c>LastLoginAt</c> could not answer this: it moves on sign-in only, so someone who signed in a week
/// ago and is transcribing right now looked a week gone. Written at most once a minute per account
/// (<see cref="LastSeen.WriteEvery"/>), first from an in-process note of who was written recently and
/// then by the guarded UPDATE itself, so a busy polling client costs one small write a minute and the
/// request never waits on a tracked entity. It runs after the response, and a failure is only logged:
/// a presence stamp is never worth an error to the user.
/// </remarks>
public sealed class LastSeenMiddleware
{
    private static readonly ConcurrentDictionary<Guid, DateTime> Recent = new();
    private const int MaxRemembered = 50_000;

    private readonly RequestDelegate _next;

    public LastSeenMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(
        HttpContext context, ICurrentUser currentUser, IApplicationDbContext db, IDateTimeProvider clock,
        ILogger<LastSeenMiddleware> logger)
    {
        await _next(context);

        if (currentUser.UserId is not { } userId)
            return;

        var now = clock.UtcNow;
        if (Recent.TryGetValue(userId, out var written) && now - written < LastSeen.WriteEvery)
            return;
        if (Recent.Count > MaxRemembered)
            Recent.Clear();
        Recent[userId] = now;

        try
        {
            var stale = now - LastSeen.WriteEvery;
            await db.Users
                .Where(u => u.Id == userId && (u.LastSeenAtUtc == null || u.LastSeenAtUtc < stale))
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.LastSeenAtUtc, now), CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Could not record last seen for {UserId}.", userId);
        }
    }
}
