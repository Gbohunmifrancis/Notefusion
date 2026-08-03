using Microsoft.AspNetCore.Mvc;
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
