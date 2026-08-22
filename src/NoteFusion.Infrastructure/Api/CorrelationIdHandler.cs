using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Api;

/// <summary>
/// Stamps the current correlation id onto every call this API makes to the Python worker, so the two
/// services' logs describe the same request under the same name.
/// </summary>
/// <remarks>
/// Adds nothing when there is no id to add, which is the case for <c>TranscriptionCompletionWorker</c> —
/// it polls on its own timer, outside any request, so there is genuinely nothing to correlate to and a
/// freshly minted id there would be a false trail rather than a useful one. The worker's own logs carry
/// the job id, which is what joins them to the request that created it.
/// </remarks>
internal sealed class CorrelationIdHandler : DelegatingHandler
{
    private const string HeaderName = "X-Correlation-ID";

    private readonly ICorrelationId _correlationId;

    public CorrelationIdHandler(ICorrelationId correlationId) => _correlationId = correlationId;

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var id = _correlationId.Current;
        if (!string.IsNullOrEmpty(id))
        {
            // Replace rather than add: a retried request already carries the header from the first attempt,
            // and HttpRequestHeaders.Add would append a second value instead of overwriting.
            request.Headers.Remove(HeaderName);
            request.Headers.Add(HeaderName, id);
        }

        return base.SendAsync(request, cancellationToken);
    }
}
