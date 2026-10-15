using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities.Billing;

/// <summary>
/// A sellable subscription plan. Price is stored in the currency's minor units (cents for USD) to
/// keep money integral — no floating-point drift on financial values. Seeded, not user-created;
/// the mobile paywall lists active plans.
/// </summary>
public class Plan : BaseEntity
{
    private Plan() { } // EF Core

    public string Code { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public long AmountMinor { get; private set; }
    public string Currency { get; private set; } = "USD";
    public BillingInterval Interval { get; private set; }
    public bool IsActive { get; private set; }

    /// <summary>
    /// Singers a choir plan seats besides the director; null for every plan that is not a choir plan. A choir
    /// plan's payment opens or extends the payer's <see cref="Choir"/> rather than their own Pro membership.
    /// </summary>
    public int? ChoirSeats { get; private set; }

    /// <summary>True for a choir plan (see <see cref="ChoirSeats"/>).</summary>
    public bool IsChoir => ChoirSeats is not null;

    public static Plan Create(
        Guid id, string code, string name, long amountMinor, string currency, BillingInterval interval,
        int? choirSeats = null)
        => new()
        {
            Id = id == Guid.Empty ? Guid.NewGuid() : id,
            Code = Guard.NotNullOrWhiteSpace(code),
            Name = Guard.NotNullOrWhiteSpace(name),
            AmountMinor = amountMinor > 0
                ? amountMinor
                : throw new ArgumentOutOfRangeException(nameof(amountMinor), amountMinor, "Amount must be positive."),
            Currency = Guard.NotNullOrWhiteSpace(currency).ToUpperInvariant(),
            Interval = interval,
            IsActive = true,
            ChoirSeats = choirSeats is null or > 0
                ? choirSeats
                : throw new ArgumentOutOfRangeException(nameof(choirSeats), choirSeats, "A choir plan seats at least one singer.")
        };

    /// <summary>
    /// Takes the plan off sale without deleting it. Past charges and live subscriptions still point here by
    /// id, and the receipt, the expiry notice and the "my subscription" query all read the plan to name what
    /// was bought — so a retired plan has to stay readable. Only the paywall and the checkout stop offering
    /// it, since both filter on <see cref="IsActive"/>.
    /// </summary>
    public void Retire() => IsActive = false;
}
