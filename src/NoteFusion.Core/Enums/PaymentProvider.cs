namespace NoteFusion.Core.Enums;

/// <summary>
/// The payment providers NoteFusion integrates, each behind the same gateway abstraction so the
/// choice of provider is a routing decision rather than a code change. Multi-provider from day one
/// covers regional gaps (Squad is Nigeria/NGN-only) and provider outages. Paystack, Bachs and Flutterwave have
/// live adapters; Squad is declared but credential-gated (see the gateway factory).
/// </summary>
/// <remarks>
/// <see cref="GooglePlay"/> is not a checkout gateway: the Android app buys through Google Play's own sheet, and
/// the server only verifies what Google reports (<c>GooglePlaySync</c>). It never collects a currency, so the
/// factory never routes a checkout to it.
/// </remarks>
public enum PaymentProvider
{
    Paystack = 1,
    Flutterwave = 2,
    Bachs = 3,
    Squad = 4,
    GooglePlay = 5
}
