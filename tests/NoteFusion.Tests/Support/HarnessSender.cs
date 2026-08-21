using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Tests.Support;

/// <summary>
/// An <see cref="ISender"/> that dispatches to real handlers built on a <see cref="TestHarness"/>.
/// </summary>
/// <remarks>
/// Only the nested requests the handlers under test actually send are wired up; anything else throws
/// rather than returning a default, so a handler that starts delegating somewhere new fails loudly instead
/// of quietly succeeding against a stub. Real handlers, not recorded calls: the point of a test that sends
/// <see cref="ForgotPasswordCommand"/> is that a token really gets stored and a link really gets built,
/// and the point of one that sends <see cref="ReconcilePaymentCommand"/> is that money really gets
/// fulfilled exactly once.
/// <para>
/// The gateway factory and the caller identity are optional because most senders need neither; a test that
/// dispatches a request requiring one and did not supply it gets an explicit failure, for the same
/// fail-loudly reason as the unwired branch.
/// </para>
/// </remarks>
public sealed class HarnessSender : ISender
{
    private readonly TestHarness _h;
    private readonly IPaymentGatewayFactory? _gateways;
    private readonly ICurrentUser? _currentUser;

    public HarnessSender(
        TestHarness harness, IPaymentGatewayFactory? gateways = null, ICurrentUser? currentUser = null)
    {
        _h = harness;
        _gateways = gateways;
        _currentUser = currentUser;
    }

    public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
        => request switch
        {
            ForgotPasswordCommand forgot => (Task<TResponse>)(object)new ForgotPasswordCommandHandler(
                    _h.Db, _h.Tokens, _h.Clock, _h.Email, _h.Auth,
                    NullLogger<ForgotPasswordCommandHandler>.Instance)
                .Handle(forgot, cancellationToken),
            ReconcilePaymentCommand reconcile => (Task<TResponse>)(object)new ReconcilePaymentCommandHandler(
                    _h.Db, Require(_gateways, "gateways"), _h.Clock, _h.Email)
                .Handle(reconcile, cancellationToken),
            GetMySubscriptionQuery mine => (Task<TResponse>)(object)new GetMySubscriptionQueryHandler(
                    _h.Db, Require(_currentUser, "currentUser"), _h.Clock)
                .Handle(mine, cancellationToken),
            _ => throw new NotSupportedException($"{request.GetType().Name} is not wired into the test sender.")
        };

    private static T Require<T>(T? dependency, string name) where T : class
        => dependency ?? throw new InvalidOperationException(
            $"This request needs a {typeof(T).Name}; pass one as the '{name}' argument to HarnessSender.");

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
