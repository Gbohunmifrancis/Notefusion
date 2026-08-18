using System.Net;

namespace NoteFusion.Tests.Support;

/// <summary>
/// A scripted <see cref="HttpMessageHandler"/> for testing payment adapters without a network. It
/// records every request it saw — including headers and the exact body bytes — because for a payment
/// gateway what we SEND is as much part of the contract as what we do with the reply: an idempotency
/// key that is missing, or a body that changes between retries, is a real defect that a
/// response-only stub could never catch.
/// </summary>
public sealed class StubHttpMessageHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, int, HttpResponseMessage> _respond;

    public StubHttpMessageHandler(Func<HttpRequestMessage, int, HttpResponseMessage> respond)
        => _respond = respond;

    /// <summary>Always answers with one canned status and body.</summary>
    public static StubHttpMessageHandler Returning(HttpStatusCode status, string body)
        => new((_, _) => Respond(status, body));

    /// <summary>Always throws, standing in for a connection that never completes.</summary>
    public static StubHttpMessageHandler Throwing(Exception error)
        => new((_, _) => throw error);

    /// <summary>Each captured request, in order, with its body already read to a string.</summary>
    public List<CapturedRequest> Requests { get; } = [];

    public static HttpResponseMessage Respond(HttpStatusCode status, string body)
        => new(status) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        var headers = request.Headers.ToDictionary(
            h => h.Key, h => string.Join(",", h.Value), StringComparer.OrdinalIgnoreCase);

        Requests.Add(new CapturedRequest(request.Method, request.RequestUri, headers, body));

        // Attempt number, so a test can script "fail once, then succeed".
        return _respond(request, Requests.Count);
    }

    public sealed record CapturedRequest(
        HttpMethod Method,
        Uri? Uri,
        IReadOnlyDictionary<string, string> Headers,
        string? Body);
}
