using NoteFusion.Application.Common.Errors;
using NoteFusion.Shared.Results;
using Polly;
using Polly.CircuitBreaker;

namespace NoteFusion.Infrastructure.Http;

/// <summary>
/// The exceptions an outside call ends in when it got no answer at all, beside the
/// <see cref="HttpRequestException"/> each client already handles: refused by an open breaker
/// (<see cref="BrokenCircuitException"/>), out of time (Polly's <c>TimeoutRejectedException</c>, or
/// HttpClient's own <see cref="TaskCanceledException"/> where no pipeline governs). The caller's own
/// cancellation is not one of them: that is let out.
/// </summary>
internal static class OutboundFailure
{
    public static bool IsUnanswered(Exception ex, CancellationToken callerToken)
        => ex is ExecutionRejectedException
           || (ex is OperationCanceledException && !callerToken.IsCancellationRequested);

    public static bool IsBreakerOpen(Exception ex) => ex is BrokenCircuitException;

    /// <summary>
    /// The breaker refused the request before any attempt of it went out, so the provider cannot have acted
    /// on it. False when an earlier attempt timed out and the breaker opened before the retry: that attempt
    /// may have landed.
    /// </summary>
    public static bool NothingSent(Exception ex, HttpRequestMessage request)
        => IsBreakerOpen(ex) && !request.Options.TryGetValue(AttemptMarker.Attempted, out _);

    /// <summary>
    /// An open breaker as <see cref="ProviderErrors.Unavailable"/> (a batch waits for the next run rather than
    /// counting a try), anything else as a network error under the caller's own code. Both are plain sentences with no provider text in them.
    /// </summary>
    public static Error ToError(Exception ex, string code, string providerName)
        => IsBreakerOpen(ex)
            ? ProviderErrors.Unavailable
            : Error.Network(code, $"{providerName} did not answer in time.");
}
