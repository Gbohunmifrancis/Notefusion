namespace NoteFusion.Api.Middleware;

/// <summary>
/// Gives every request one identifier, echoes it back to the caller, and puts it in scope so that every log
/// line the request produces carries it.
/// </summary>
/// <remarks>
/// <para>
/// First real middleware in the pipeline, and specifically <b>outside</b>
/// <see cref="ExceptionHandlingMiddleware"/>: the 500 that middleware logs is the single most useful line
/// to be able to find, so it has to be written inside this scope, not around it.
/// </para>
/// <para>
/// An inbound <c>X-Correlation-ID</c> is honoured, so a mobile client can quote the id in a support mail
/// and it will match the server's logs — but only after
/// <see cref="Sanitised"/> has vetted it. The value ends up in log lines and in an outbound HTTP header,
/// which makes an unchecked one both a log-forging vector (a newline writes a fabricated entry) and a
/// header-injection vector.
/// </para>
/// </remarks>
public sealed class CorrelationIdMiddleware
{
    /// <summary>Header read on the way in and written on the way out. The de facto standard spelling.</summary>
    public const string HeaderName = "X-Correlation-ID";

    /// <summary>Where the resolved value is parked for <see cref="Common.RequestCorrelationId"/> to read.</summary>
    public const string ItemKey = "NoteFusion.CorrelationId";

    /// <summary>
    /// Long enough for a GUID or a client's own trace id, short enough that a caller cannot pad a log file
    /// with one header.
    /// </summary>
    private const int MaxLength = 64;

    private readonly RequestDelegate _next;
    private readonly ILogger<CorrelationIdMiddleware> _logger;

    public CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId =
            Sanitised(context.Request.Headers[HeaderName].ToString())
            ?? Guid.NewGuid().ToString("N");

        context.Items[ItemKey] = correlationId;

        // Framework-emitted logs (Kestrel, routing, MVC) tag themselves with TraceIdentifier rather than
        // anything of ours, so overwriting it is what makes those lines findable by the same key.
        context.TraceIdentifier = correlationId;

        // Set now rather than after _next: a response that has already begun streaming cannot take another
        // header, and the one request most worth correlating is the one that failed halfway through.
        context.Response.Headers[HeaderName] = correlationId;

        using (_logger.BeginScope(new Dictionary<string, object>
        {
            ["CorrelationId"] = correlationId,
        }))
        {
            await _next(context);
        }
    }

    /// <summary>
    /// The caller's value if it is safe to repeat, otherwise null. Conservative on purpose: anything
    /// outside letters, digits, dash and underscore is refused outright rather than stripped, because a
    /// value that has been quietly edited no longer matches whatever the client wrote down.
    /// </summary>
    private static string? Sanitised(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
            return null;

        var value = candidate.Trim();
        if (value.Length > MaxLength)
            return null;

        foreach (var c in value)
        {
            var ok = c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '-' or '_';
            if (!ok)
                return null;
        }

        return value;
    }
}
