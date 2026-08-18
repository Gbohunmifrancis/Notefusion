namespace NoteFusion.Core.Enums;

/// <summary>
/// The payment providers NoteFusion integrates, each behind the same gateway abstraction so the
/// choice of provider is a routing decision rather than a code change. Multi-provider from day one
/// covers regional gaps (Squad is Nigeria/NGN-only) and provider outages. Paystack and Bachs have live
/// adapters today; the others are declared but credential-gated (see the gateway factory).
/// </summary>
public enum PaymentProvider
{
    Paystack = 1,
    Flutterwave = 2,
    Bachs = 3,
    Squad = 4
}
