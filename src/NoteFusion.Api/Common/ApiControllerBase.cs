using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Realtime;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Shared.Results;

namespace NoteFusion.Api.Common;

/// <summary>
/// Base for all API controllers. Translates a <see cref="Result"/> into the correct HTTP response and
/// maps <see cref="ErrorType"/> to a status code in one place, so controllers stay thin and consistent.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public abstract class ApiControllerBase : ControllerBase
{
    /// <summary>200 with the value, or the mapped error response.</summary>
    protected IActionResult HandleResult<T>(Result<T> result)
        => result.IsSuccess ? Ok(result.Value) : Problem(result.Error);

    /// <summary>201 with a Location header, or the mapped error response.</summary>
    protected IActionResult HandleCreated<T>(Result<T> result, string routeName, object routeValues)
        => result.IsSuccess
            ? CreatedAtRoute(routeName, routeValues, result.Value)
            : Problem(result.Error);

    /// <summary>204 on success, or the mapped error response.</summary>
    protected IActionResult HandleNoContent(Result result)
        => result.IsSuccess ? NoContent() : Problem(result.Error);

    /// <summary>
    /// A job's event stream (<see cref="JobEventStream"/>) for a caller <paramref name="query"/> allows; 404 for anyone
    /// else, 429 when they (or the server) already hold too many open. <paramref name="away"/>: a hidden tab's, which is
    /// told everything but does not count as looking at the job (<see cref="IJobEvents.Watch"/>).
    /// </summary>
    protected async Task<IActionResult> StreamJobAsync(
        ISender sender, IJobEvents events, JsonSerializerOptions json, GetJobWatchQuery query, bool away, CancellationToken ct)
    {
        var state = await sender.Send(query, ct);
        if (state.IsFailure)
            return Problem(state.Error);

        using var watch = state.Value.Ended ? null : events.Watch(query.JobId, state.Value.Watcher, away);
        if (!state.Value.Ended && watch is null)
            return StatusCode(StatusCodes.Status429TooManyRequests, new ApiError(
                "JOB_STREAMS_FULL", "Too many live views are open at once. Close one and try again."));

        await JobEventStream.WriteAsync(Response, query.JobId, watch, json, ct);
        return new EmptyResult();
    }

    /// <summary>
    /// A backing track (MP3) for its owner: seekable by range, kept by the browser or phone for this person only
    /// (never a shared cache), or the mapped error.
    /// </summary>
    protected IActionResult Backing(Result<byte[]> result)
    {
        if (result.IsFailure)
            return Problem(result.Error);
        Response.Headers.CacheControl = "private, max-age=86400";
        return File(result.Value, "audio/mpeg", enableRangeProcessing: true);
    }

    private IActionResult Problem(Error error)
    {
        var status = StatusFor(error.Type);
        return StatusCode(status, new ApiError(error.Code, error.Message));
    }

    internal static int StatusFor(ErrorType type) => type switch
    {
        ErrorType.Validation => StatusCodes.Status422UnprocessableEntity,
        ErrorType.NotFound => StatusCodes.Status404NotFound,
        ErrorType.Conflict => StatusCodes.Status409Conflict,
        ErrorType.Unauthorized => StatusCodes.Status401Unauthorized,
        ErrorType.Forbidden => StatusCodes.Status403Forbidden,
        ErrorType.Network => StatusCodes.Status502BadGateway,
        _ => StatusCodes.Status400BadRequest
    };
}
