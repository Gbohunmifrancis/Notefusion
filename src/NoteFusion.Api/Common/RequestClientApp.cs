using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Common;

/// <summary>
/// Tells a browser from the mobile app by the User-Agent: every browser's begins "Mozilla/", and the app's
/// HTTP stacks (okhttp on Android, CFNetwork on iOS) never do. Good enough for a label on the activity log,
/// which is all it is used for; nothing is allowed or refused on it.
/// </summary>
public sealed class RequestClientApp : IClientApp
{
    private readonly IHttpContextAccessor _http;

    public RequestClientApp(IHttpContextAccessor http) => _http = http;

    public string? Current
    {
        get
        {
            var agent = _http.HttpContext?.Request.Headers.UserAgent.ToString();
            if (agent is null)
                return null;
            return agent.StartsWith("Mozilla/", StringComparison.Ordinal) ? "web" : "app";
        }
    }
}
