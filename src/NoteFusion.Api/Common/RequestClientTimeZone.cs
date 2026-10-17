using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Common;

/// <summary>
/// The time zone the client names in <c>X-Time-Zone</c> (the mobile app sends its IANA zone on every request,
/// see <c>mobile/src/api/client.ts</c>). Passed through raw; <c>PracticeTime.Resolve</c> decides what it means.
/// </summary>
public sealed class RequestClientTimeZone : IClientTimeZone
{
    public const string HeaderName = "X-Time-Zone";

    private readonly IHttpContextAccessor _http;

    public RequestClientTimeZone(IHttpContextAccessor http) => _http = http;

    public string? Current
    {
        get
        {
            var value = _http.HttpContext?.Request.Headers[HeaderName].ToString();
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }
    }
}
