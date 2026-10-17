using System.Text.Json;
using NoteFusion.Api.Common;

namespace NoteFusion.Api.Middleware;

/// <summary>
/// The read-only switch for a planned move to another server or provider (docs/BACKUP_AND_MIGRATION.md,
/// "Moving to another cloud"): with <c>Maintenance__ReadOnly=true</c> every request that could change
/// something — anything but GET, HEAD and OPTIONS — is answered 503 with a plain sentence and Retry-After,
/// while reading keeps working. The final backup taken during that window then holds every write there
/// will ever be on the old server.
/// </summary>
/// <remarks>
/// Off unless set. Clients already treat a 503 as "try again" and keep the session (a token refresh that
/// gets one is not a sign-out). Payment providers retry webhooks they could not deliver, so a payment made
/// during the window is applied on the new server. Background workers are not stopped by this; the runbook
/// also makes the database itself read-only before the final dump.
/// </remarks>
public sealed class MaintenanceModeMiddleware
{
    public const string Code = "MAINTENANCE_READ_ONLY";

    public const string Message =
        "NoteFusion is moving to a new home for a few minutes. You can still open your sheets; "
        + "saving and new transcriptions will be back shortly.";

    /// <summary>Seconds a client is asked to wait before trying a write again.</summary>
    public const int RetryAfterSeconds = 120;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly RequestDelegate _next;

    public MaintenanceModeMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        if (IsRead(context.Request.Method))
        {
            await _next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        context.Response.Headers.RetryAfter = RetryAfterSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
        context.Response.ContentType = "application/json; charset=utf-8";
        await context.Response.WriteAsync(JsonSerializer.Serialize(new ApiError(Code, Message), Json));
    }

    internal static bool IsRead(string method)
        => HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);

    /// <summary>
    /// <c>Maintenance:ReadOnly</c>, read leniently: <c>true</c>, <c>1</c> or <c>yes</c> in any case turns it
    /// on, and anything else — blank included — leaves it off, so a stray value can never stop the API.
    /// </summary>
    public static bool IsEnabled(IConfiguration configuration)
    {
        var value = configuration["Maintenance:ReadOnly"]?.Trim();
        return string.Equals(value, "true", StringComparison.OrdinalIgnoreCase)
            || value == "1"
            || string.Equals(value, "yes", StringComparison.OrdinalIgnoreCase);
    }
}
