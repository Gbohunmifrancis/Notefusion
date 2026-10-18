using System.Globalization;
using System.Text.RegularExpressions;
using NoteFusion.Application.Common;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Admin.PaymentAlerts;

/// <summary>What the admins' push says about one completed payment (board f-admin/08).</summary>
/// <param name="PlanName">The plan's stored name ("NoteFusion Pro (Monthly)"); shortened for the title.</param>
/// <param name="Country">The payer's ISO country code, named for a payment in dollars ("from Ghana").</param>
/// <param name="FirstPayment">No earlier completed payment on the account.</param>
/// <param name="ProUntilUtc">When the membership this payment bought now runs to; null for one song or a choir.</param>
/// <param name="PaidAtUtc">When it completed: "Pro for a year" is a fresh year from then.</param>
public sealed record PaymentAlertFacts(
    Guid PaymentId,
    long AmountMinor,
    string Currency,
    string? PlanName,
    BillingInterval? Interval,
    int? ChoirSeats,
    string? CustomerName,
    string? Country,
    bool FirstPayment,
    DateTime? ProUntilUtc,
    DateTime PaidAtUtc);

/// <summary>A push's two lines.</summary>
public sealed record PaymentPushWords(string Title, string Body);

/// <summary>
/// The payment alert's words. The title is what an admin glances for, the amount and what it bought
/// ("₦7,500 · Pro Monthly"); the line under it is who ("Ada Obi just paid. Pro until Wed 18 Nov."). Amounts are in
/// the currency paid, never converted and never added across currencies. No pronoun names the customer. A title is at
/// most <see cref="TitleMax"/> characters and a line <see cref="BodyMax"/>, so neither is cut off on a lock screen.
/// </summary>
public static partial class PaymentPushCopy
{
    public const int TitleMax = 40;
    public const int BodyMax = 90;

    /// <summary>The line when the phone asked for names to be left out: the name is one tap away in Admin.</summary>
    public const string HiddenBody = "Tap to see who paid.";

    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    /// <summary>One payment.</summary>
    public static PaymentPushWords Single(PaymentAlertFacts f, bool hideNames)
    {
        var head = $"{Money(f.AmountMinor, f.Currency)} · {ShortPlan(f.PlanName)}";
        var title = f.FirstPayment && head.Length + FirstSuffix.Length <= TitleMax ? head + FirstSuffix : head;
        return new PaymentPushWords(Clip(title, TitleMax), hideNames ? HiddenBody : Line(f));
    }

    /// <summary>
    /// Several payments at once, as one summary: "2 payments · ₦7,500 · $39.99" (each currency summed on its own) over
    /// the names.
    /// </summary>
    public static PaymentPushWords Summary(IReadOnlyList<PaymentAlertFacts> payments, bool hideNames)
    {
        if (payments.Count == 1)
            return Single(payments[0], hideNames);

        var totals = payments
            .GroupBy(p => p.Currency.ToUpperInvariant())
            .Select(g => Money(g.Sum(p => p.AmountMinor), g.Key))
            .ToList();

        var title = $"{payments.Count} payments · {string.Join(" · ", totals)}";
        if (title.Length > TitleMax)
            title = $"{payments.Count} payments · {totals[0]} and more";

        return new PaymentPushWords(Clip(title, TitleMax), hideNames ? HiddenBody : Names(payments));
    }

    /// <summary>"Send a test alert": the words a real one has, and says it is a test.</summary>
    public static PaymentPushWords Test() =>
        new("₦7,500 · Pro Monthly", "A test alert: this is how a payment will look and sound.");

    private const string FirstSuffix = " · first payment";

    private static string Line(PaymentAlertFacts f)
    {
        var name = Name(f.CustomerName);
        var first = FirstName(f.CustomerName);

        // Shortest last: a long name drops the country, then goes by its first name, then is clipped.
        foreach (var who in new[] { name, first })
        {
            foreach (var withCountry in new[] { true, false })
            {
                var line = Sentence(f, who, withCountry);
                if (line.Length <= BodyMax)
                    return line;
            }
        }

        return Clip(Sentence(f, first, withCountry: false), BodyMax);
    }

    private static string Sentence(PaymentAlertFacts f, string who, bool withCountry)
    {
        if (f.Interval == BillingInterval.Single)
            return $"{who} just bought a song.";

        if (f.ChoirSeats is { } seats)
            return $"{who} just paid for a choir: {seats} seats.";

        if (f.FirstPayment)
            return $"{who} just paid for the first time.";

        var from = withCountry ? From(f) : "";
        return $"{who} just paid{from}. {What(f)}";
    }

    /// <summary>What the payment bought, in time: "Pro until Wed 18 Nov.", "Pro for a year.", "Pro for life."</summary>
    private static string What(PaymentAlertFacts f)
    {
        if (f.ProUntilUtc is not { } until)
            return "Pro is on.";
        if (until >= LifetimeFrom)
            return "Pro for life.";

        var local = until + FreeTier.WestAfricaOffset;
        if (f.Interval == BillingInterval.Yearly)
        {
            // A fresh year reads as one; a year stacked on time already left names the day it now runs to.
            var fresh = Math.Abs((until - f.PaidAtUtc.AddYears(1)).TotalDays) <= 2;
            return fresh ? "Pro for a year." : $"Pro until {local.ToString("d MMM yyyy", Invariant)}.";
        }

        return $"Pro until {local.ToString("ddd d MMM", Invariant)}.";
    }

    /// <summary>A membership running past this is a lifetime one (the sentinel is the year 9999).</summary>
    private static readonly DateTime LifetimeFrom = new(9000, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>", from Ghana" for a payment in dollars; naira already says Nigeria.</summary>
    private static string From(PaymentAlertFacts f)
    {
        if (string.Equals(f.Currency, "NGN", StringComparison.OrdinalIgnoreCase))
            return "";
        var country = CountryName(f.Country);
        return country is null ? "" : $", from {country}";
    }

    private static string Names(IReadOnlyList<PaymentAlertFacts> payments)
    {
        var names = payments.Select(p => Name(p.CustomerName)).Distinct().ToList();
        var line = Join(names, 3);
        if (line.Length <= BodyMax)
            return line;

        var firsts = payments.Select(p => FirstName(p.CustomerName)).Distinct().ToList();
        line = Join(firsts, 3);
        return line.Length <= BodyMax ? line : Join(firsts, 1);
    }

    /// <summary>"A", "A and B", "A, B and C", "A, B and 3 others".</summary>
    private static string Join(IReadOnlyList<string> names, int shown)
    {
        if (names.Count == 1)
            return names[0];
        if (names.Count <= shown)
            return $"{string.Join(", ", names.Take(names.Count - 1))} and {names[^1]}";

        var others = names.Count - (shown - 1);
        var lead = names.Take(Math.Max(1, shown - 1));
        return $"{string.Join(", ", lead)} and {others} others";
    }

    private static string Name(string? fullName)
        => string.IsNullOrWhiteSpace(fullName) ? "Someone" : Spaces().Replace(fullName.Trim(), " ");

    private static string FirstName(string? fullName)
        => Name(fullName).Split(' ')[0];

    /// <summary>"NoteFusion Pro (Monthly)" → "Pro Monthly"; "One song" stays; nothing → "Payment".</summary>
    public static string ShortPlan(string? planName)
    {
        if (string.IsNullOrWhiteSpace(planName))
            return "Payment";
        var m = StoredPlanName().Match(planName.Trim());
        return m.Success ? $"{m.Groups[1].Value} {m.Groups[2].Value}" : planName.Trim();
    }

    /// <summary>
    /// The amount in the currency paid: "₦7,500", "₦7,500.50", "$39.99". Minor units are kobo and cents; any other
    /// currency is written with its code.
    /// </summary>
    public static string Money(long amountMinor, string currency)
    {
        var code = currency.ToUpperInvariant();
        var major = amountMinor / 100m;
        return code switch
        {
            "NGN" => "₦" + major.ToString(amountMinor % 100 == 0 ? "#,0" : "#,0.00", Invariant),
            "USD" => "$" + major.ToString("#,0.00", Invariant),
            _ => $"{code} {major.ToString("#,0.00", Invariant)}",
        };
    }

    /// <summary>The countries payers come from, by name; anything else goes unnamed rather than as a bare code.</summary>
    public static string? CountryName(string? iso)
        => iso is null ? null : Countries.GetValueOrDefault(iso.Trim().ToUpperInvariant());

    private static readonly Dictionary<string, string> Countries = new()
    {
        ["NG"] = "Nigeria", ["GH"] = "Ghana", ["KE"] = "Kenya", ["ZA"] = "South Africa", ["UG"] = "Uganda",
        ["TZ"] = "Tanzania", ["RW"] = "Rwanda", ["CM"] = "Cameroon", ["ZM"] = "Zambia", ["ZW"] = "Zimbabwe",
        ["ET"] = "Ethiopia", ["EG"] = "Egypt", ["MW"] = "Malawi", ["SL"] = "Sierra Leone", ["LR"] = "Liberia",
        ["GM"] = "The Gambia", ["SN"] = "Senegal", ["CI"] = "Côte d'Ivoire", ["BJ"] = "Benin", ["TG"] = "Togo",
        ["BW"] = "Botswana", ["NA"] = "Namibia", ["MZ"] = "Mozambique", ["CD"] = "DR Congo", ["SS"] = "South Sudan",
        ["IN"] = "India", ["PK"] = "Pakistan", ["BD"] = "Bangladesh", ["LK"] = "Sri Lanka", ["NP"] = "Nepal",
        ["ID"] = "Indonesia", ["PH"] = "the Philippines", ["VN"] = "Vietnam", ["MM"] = "Myanmar", ["KH"] = "Cambodia",
        ["LA"] = "Laos", ["US"] = "the US", ["GB"] = "the UK", ["CA"] = "Canada", ["IE"] = "Ireland",
        ["DE"] = "Germany", ["FR"] = "France", ["NL"] = "the Netherlands", ["AU"] = "Australia", ["AE"] = "the UAE",
    };

    private static string Clip(string s, int max) => s.Length <= max ? s : s[..(max - 1)].TrimEnd() + "…";

    [GeneratedRegex(@"^NoteFusion\s+(.+?)\s*\((.+)\)$")]
    private static partial Regex StoredPlanName();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
