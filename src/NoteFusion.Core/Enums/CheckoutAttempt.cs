namespace NoteFusion.Core.Enums;

/// <summary>
/// What a provider's hosted page has seen of the customer, read whenever the API verifies the session. Declared
/// weakest first: a checkout keeps the strongest signal it has shown (<c>PaymentTransaction.RecordProviderAttempt</c>),
/// so a card declined before a transfer was started reads as the transfer. Stored by name. It is a record of what
/// happened on the page and nothing else: fulfilment never reads it.
/// </summary>
public enum CheckoutAttempt
{
    /// <summary>The session was read and no payment had been tried.</summary>
    None = 0,

    /// <summary>A charge was tried and failed: a card declined (Bachs' failed charge, Paystack's failed transaction).</summary>
    Declined = 1,

    /// <summary>Money is on its way: a bank transfer under way, its charge processing with the balance outstanding.</summary>
    TransferStarted = 2
}
