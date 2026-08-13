using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.Gateways;

/// <summary>
/// A placeholder adapter for a provider that is listed in the product plan (Squad, Flutterwave, Bachs)
/// but not yet wired to a live integration. It conforms to <see cref="IPaymentGateway"/> so the factory
/// and the rest of the pipeline treat every provider uniformly, but every call fails fast with
/// <c>ProviderNotConfigured</c> rather than pretending to move money. Replace with a real adapter
/// (mirroring <see cref="PaystackPaymentGateway"/>) once that provider is credentialed. Building four
/// untested HTTP clients up front would give false confidence in money-handling code.
/// </summary>
internal sealed class StubPaymentGateway : IPaymentGateway
{
    public StubPaymentGateway(PaymentProvider provider, IReadOnlyCollection<string> supportedCurrencies)
    {
        Provider = provider;
        SupportedCurrencies = supportedCurrencies;
    }

    public PaymentProvider Provider { get; }
    public IReadOnlyCollection<string> SupportedCurrencies { get; }

    public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
        => Task.FromResult(Result.Failure<GatewayInitiation>(BillingErrors.ProviderNotConfigured));

    public Task<Result<GatewayVerification>> VerifyAsync(string reference, CancellationToken ct)
        => Task.FromResult(Result.Failure<GatewayVerification>(BillingErrors.ProviderNotConfigured));
}
