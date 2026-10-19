using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Realtime;

/// <summary>
/// Writes one job's event stream (<c>text/event-stream</c>), which the clients hold while they watch a job instead of
/// polling it: <c>ready</c> once subscribed (the client then asks for the job once), <c>job</c> each time the worker
/// reports progress, and <c>ended</c> when it finished or failed (the client asks for the outcome), after which the
/// stream closes. A comment every <see cref="Ping"/> keeps proxies from closing a quiet stream and lets the client tell
/// a live one from a dead one; after <see cref="MaxOpen"/> it closes and the client opens it again.
/// </summary>
public static class JobEventStream
{
    public static readonly TimeSpan Ping = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan MaxOpen = TimeSpan.FromMinutes(10);

    /// <summary>Streams <paramref name="watch"/>'s events, or says <c>ended</c> at once when it is null.</summary>
    public static Task WriteAsync(
        HttpResponse response, string jobId, JobWatch? watch, JsonSerializerOptions json, CancellationToken ct)
        => WriteAsync(response, jobId, watch, json, Ping, MaxOpen, ct);

    internal static async Task WriteAsync(
        HttpResponse response, string jobId, JobWatch? watch, JsonSerializerOptions json,
        TimeSpan ping, TimeSpan maxOpen, CancellationToken ct)
    {
        response.StatusCode = StatusCodes.Status200OK;
        response.ContentType = "text/event-stream";
        // Not cached, not compressed or held by a proxy: each event has to reach the client as it is written.
        response.Headers.CacheControl = "no-cache, no-transform";
        response.Headers["X-Accel-Buffering"] = "no";
        response.HttpContext.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();

        var ended = JsonSerializer.Serialize(new { jobId }, json);
        try
        {
            if (watch is null)
            {
                await SendAsync(response, JobEvent.Ended, ended, ct);
                return;
            }

            using var open = CancellationTokenSource.CreateLinkedTokenSource(ct);
            open.CancelAfter(maxOpen);
            await SendAsync(response, "ready", "{}", open.Token);
            while (true)
            {
                using (var quiet = CancellationTokenSource.CreateLinkedTokenSource(open.Token))
                {
                    quiet.CancelAfter(ping);
                    try
                    {
                        if (!await watch.Events.WaitToReadAsync(quiet.Token))
                            return;
                    }
                    catch (OperationCanceledException) when (!open.IsCancellationRequested)
                    {
                        await response.WriteAsync(": ping\n\n", open.Token);
                        await response.Body.FlushAsync(open.Token);
                        continue;
                    }
                }

                while (watch.Events.TryRead(out var next))
                {
                    if (next.Name == JobEvent.Ended)
                    {
                        await SendAsync(response, JobEvent.Ended, ended, open.Token);
                        return;
                    }
                    await SendAsync(response, next.Name, next.Job is null ? "{}" : JsonSerializer.Serialize(next.Job, json), open.Token);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // The client went away, or the stream's time is up and it will open another.
        }
    }

    private static async Task SendAsync(HttpResponse response, string name, string data, CancellationToken ct)
    {
        await response.WriteAsync($"event: {name}\ndata: {data}\n\n", ct);
        await response.Body.FlushAsync(ct);
    }
}
