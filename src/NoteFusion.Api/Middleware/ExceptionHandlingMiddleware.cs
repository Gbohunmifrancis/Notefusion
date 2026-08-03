using System.Text.Json;
using NoteFusion.Api.Common;
using NoteFusion.Application.Common.Exceptions;

namespace NoteFusion.Api.Middleware;

/// <summary>
/// Terminal error boundary. Turns a pipeline <see cref="ValidationException"/> into a 422 with per-field
/// details, and any other unhandled exception into a 500 with an opaque body — internal messages are
/// logged, never returned to the client.
/// </summary>
public sealed class ExceptionHandlingMiddleware
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (ValidationException ex)
        {
            await WriteAsync(
                context,
                StatusCodes.Status422UnprocessableEntity,
                new ApiError("Validation.Failed", "One or more validation errors occurred.", ex.Errors));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception processing {Method} {Path}", context.Request.Method, context.Request.Path);
            await WriteAsync(
                context,
                StatusCodes.Status500InternalServerError,
                new ApiError("Server.Error", "An unexpected error occurred."));
        }
    }

    private static async Task WriteAsync(HttpContext context, int status, ApiError error)
    {
        if (context.Response.HasStarted)
            return;

        context.Response.Clear();
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(JsonSerializer.Serialize(error, Json));
    }
}
