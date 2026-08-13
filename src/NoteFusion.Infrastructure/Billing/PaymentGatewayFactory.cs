using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing;

/// <summary>
/// Resolves the <see cref="IPaymentGateway"/> for a provider or a currency. Selection is server-side
/// only, so the client never chooses a provider. For a currency it prefers the configured default
/// provider when that provider supports the currency, otherwise the first registered provider that
/// does — keeping the choice deterministic.
/// </summary>
internal sealed class PaymentGatewayFactory : IPaymentGatewayFactory
{
    private readonly IReadOnlyDictionary<PaymentProvider, IPaymentGateway> _gateways;
    private readonly PaymentProvider _defaultProvider;

    public PaymentGatewayFactory(IEnumerable<IPaymentGateway> gateways, BillingSettings settings)
    {
        _gateways = gateways.ToDictionary(g => g.Provider);
        _defaultProvider = Enum.TryParse<PaymentProvider>(settings.DefaultProvider, ignoreCase: true, out var p)
            ? p
            : PaymentProvider.Paystack;
    }

    public IPaymentGateway Resolve(PaymentProvider provider)
        => _gateways.TryGetValue(provider, out var gateway)
            ? gateway
            : throw new InvalidOperationException($"No payment gateway is registered for provider '{provider}'.");

    public Result<IPaymentGateway> SelectForCurrency(string currency)
    {
        var code = currency.Trim().ToUpperInvariant();

        bool Supports(IPaymentGateway g) => g.SupportedCurrencies.Contains(code);

        if (_gateways.TryGetValue(_defaultProvider, out var preferred) && Supports(preferred))
            return Result.Success(preferred);

        var fallback = _gateways.Values.FirstOrDefault(Supports);
        return fallback is not null
            ? Result.Success(fallback)
            : Result.Failure<IPaymentGateway>(BillingErrors.CurrencyUnsupported);
    }
}
