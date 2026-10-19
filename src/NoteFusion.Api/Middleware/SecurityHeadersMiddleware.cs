namespace NoteFusion.Api.Middleware;

/// <summary>
/// Hardening headers on every response. This API is consumed by code, not browsed, so a browser that does
/// end up rendering one of its responses is told to sniff nothing, frame nothing, leak no referrer and —
/// for anything that is not one of the API's own HTML pages — run nothing at all.
/// </summary>
/// <remarks>
/// Set when the response starts rather than before the pipeline runs, because only then is the content
/// type known. An HTML response is left to declare its own policy (the billing return pages carry one that
/// allows their inline script and style); a page with none, such as Swagger UI in development, gets no CSP
/// rather than one that would break it. A header a handler already set is never overwritten.
/// </remarks>
public sealed class SecurityHeadersMiddleware
{
    /// <summary>The policy for JSON and everything else that is not a page: nothing may load or frame it.</summary>
    public const string ApiContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";

    private readonly RequestDelegate _next;

    public SecurityHeadersMiddleware(RequestDelegate next) => _next = next;

    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(static state =>
        {
            Apply(((HttpContext)state).Response);
            return Task.CompletedTask;
        }, context);

        return _next(context);
    }

    /// <summary>Adds the headers to a response about to start. Internal so it can be tested without a server.</summary>
    internal static void Apply(HttpResponse response)
    {
        var headers = response.Headers;
        SetIfAbsent(headers, "X-Content-Type-Options", "nosniff");
        SetIfAbsent(headers, "Referrer-Policy", "no-referrer");
        SetIfAbsent(headers, "X-Frame-Options", "DENY");

        // HTTPS only from now on, said on every answer that arrived over HTTPS (behind the proxy, as its
        // X-Forwarded-Proto says). Production switches UseHsts off with Security__RequireHttps=false because
        // the proxy terminates TLS, which had left the API sending no HSTS at all.
        if (response.HttpContext.Request.IsHttps)
            SetIfAbsent(headers, "Strict-Transport-Security", "max-age=31536000");

        var isHtml = response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) == true;
        if (!isHtml)
            SetIfAbsent(headers, "Content-Security-Policy", ApiContentSecurityPolicy);
    }

    private static void SetIfAbsent(IHeaderDictionary headers, string name, string value)
    {
        if (!headers.ContainsKey(name))
            headers[name] = value;
    }
}
