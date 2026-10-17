using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Api.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;

namespace NoteFusion.Api.Middleware;

/// <summary>
/// Keeps <c>User.TimeZone</c> in step with the <c>X-Time-Zone</c> a signed-in client sends (the phone app and the web
/// app send their IANA zone on every request), so the practice reminder sweep — which runs with no request to read a
/// header from — knows each singer's day and hour.
/// </summary>
/// <remarks>
/// Written once per change, not per request: an in-process note of the zone last written for each account skips the
/// database entirely while it is unchanged, and the guarded UPDATE touches the row only when the stored zone differs
/// (so a restart costs one no-op statement per account). Only a zone <see cref="PracticeTime.Known"/> accepts is
/// stored; a garbled header leaves the good one. Runs after the response, and a failure is only logged.
/// </remarks>
public sealed class ClientTimeZoneMiddleware
{
    private static readonly ConcurrentDictionary<Guid, string> Written = new();
    private const int MaxRemembered = 50_000;

    private readonly RequestDelegate _next;

    public ClientTimeZoneMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(
        HttpContext context, ICurrentUser currentUser, IApplicationDbContext db, ILogger<ClientTimeZoneMiddleware> logger)
    {
        await _next(context);

        if (currentUser.UserId is not { } userId
            || PracticeTime.Known(context.Request.Headers[RequestClientTimeZone.HeaderName].ToString()) is not { } zone)
            return;
        if (Written.TryGetValue(userId, out var last) && last == zone)
            return;
        if (Written.Count > MaxRemembered)
            Written.Clear();
        Written[userId] = zone;

        try
        {
            await db.Users
                .Where(u => u.Id == userId && (u.TimeZone == null || u.TimeZone != zone))
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.TimeZone, zone), CancellationToken.None);
        }
        catch (Exception ex)
        {
            Written.TryRemove(userId, out _);
            logger.LogDebug(ex, "Could not record the time zone for {UserId}.", userId);
        }
    }
}
