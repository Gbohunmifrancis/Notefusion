using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Auth.Commands;

namespace NoteFusion.Tests.Support;

/// <summary>
/// An <see cref="ISender"/> that dispatches to real handlers built on a <see cref="TestHarness"/>.
/// </summary>
/// <remarks>
/// Only the nested commands the admin handlers actually send are wired up; anything else throws rather
/// than returning a default, so a handler that starts delegating somewhere new fails loudly instead of
/// quietly succeeding against a stub. Real handlers, not recorded calls: the point of a test that sends
/// <see cref="ForgotPasswordCommand"/> is that a token really gets stored and a link really gets built.
/// </remarks>
public sealed class HarnessSender : ISender
{
    private readonly TestHarness _h;

    public HarnessSender(TestHarness harness) => _h = harness;

    public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
        => request switch
        {
            ForgotPasswordCommand forgot => (Task<TResponse>)(object)new ForgotPasswordCommandHandler(
                    _h.Db, _h.Tokens, _h.Clock, _h.Email, _h.Auth,
                    NullLogger<ForgotPasswordCommandHandler>.Instance)
                .Handle(forgot, cancellationToken),
            _ => throw new NotSupportedException($"{request.GetType().Name} is not wired into the test sender.")
        };

    public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default)
        where TRequest : IRequest
        => throw new NotSupportedException("Void requests are not wired into the test sender.");

    public Task<object?> Send(object request, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("Untyped dispatch is not wired into the test sender.");

    public IAsyncEnumerable<TResponse> CreateStream<TResponse>(
        IStreamRequest<TResponse> request, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("Streams are not wired into the test sender.");

    public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("Streams are not wired into the test sender.");
}
