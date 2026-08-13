using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>Resolves the concrete <see cref="IPaymentGateway"/> for a provider or a currency.</summary>
public interface IPaymentGatewayFactory
{
    /// <summary>The gateway for an explicit provider. Throws if that provider has no registered adapter.</summary>
    IPaymentGateway Resolve(PaymentProvider provider);

    /// <summary>
    /// Picks the configured default provider for a currency, or a failure if none supports it. Keeps
    /// provider choice out of the client and the domain.
    /// </summary>
    Result<IPaymentGateway> SelectForCurrency(string currency);
}
