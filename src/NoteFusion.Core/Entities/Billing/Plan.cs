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

    public static Plan Create(
        Guid id, string code, string name, long amountMinor, string currency, BillingInterval interval)
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
            IsActive = true
        };
}
