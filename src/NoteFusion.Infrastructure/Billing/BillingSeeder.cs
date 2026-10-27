using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Billing;

/// <summary>
/// Seeds the fixed plans (Pro, and the one-song purchase) at startup. Plans are product-defined (not user- or config-created), so
/// they live in code with deterministic ids derived from their code — re-running never duplicates a
/// plan, and an existing plan is left untouched (price changes ship as new plan codes, so historical
/// charges stay traceable to the price the user actually agreed to).
/// </summary>
public sealed class BillingSeeder : IHostedService
{
    // The billing model (docs/geo-billing-plan.md): a Nigerian account subscribes in naira through
    // Paystack; everyone else subscribes in dollars through Bachs. The international tier is priced
    // higher on purpose — choirs abroad are the target market and the naira tier is priced to local
    // purchasing power. Amounts are minor units — cents for USD, kobo for NGN. Yearly is priced at eight
    // months to reward the annual commitment. Lifetime is no longer sold.
    //
    // Currency is what routes a charge: PaymentGatewayFactory.SelectForCurrency sends NGN to the provider
    // that lists it (Paystack__SupportedCurrencies=NGN) and USD to Bachs (Bachs__SupportedCurrencies=USD,
    // Billing__DefaultProvider=Bachs). A Bachs subscription is a catalog product, so each USD code here
    // needs Bachs__ProductMap__<code> (a bare pro_monthly / pro_yearly mapping is honoured too). What
    // this table cannot check — that the Bachs account can bill USD cards on a schedule — is the one
    // thing to confirm in the Bachs dashboard before the dollar tier goes on sale.
    //
    // Three tiers (PlanEligibility): naira for Nigeria, the regional dollar set for the lower-income markets
    // PlanEligibility.RegionalCountries lists (the rest of Africa, South and Southeast Asia), and the standard
    // dollar set for everyone else. A regional code carries PlanEligibility.RegionalCodeMarker ("_regional"),
    // which is what keeps it out of every other region's list and checkout — so a regional price change must
    // ship as a new code that keeps the marker.
    //
    // One song (BillingInterval.Single) is one more transcription for a free account, bought once with no
    // membership: PaymentFulfillment records it as a ledger credit the free-tier gate counts.
    //
    // The choir plans (Seats set) are bought by a choir director: the payment opens or extends the director's
    // Choir, whose members — up to Seats singers besides the director — are Pro while it runs and share one
    // monthly song pool (SongCredits.ChoirMonthlyPool). Same three tiers and the same marker convention.
    private static readonly (string Code, string Name, long AmountMinor, string Currency, BillingInterval Interval, int? Seats)[] Plans =
    [
        ("pro_monthly_ngn",          "NoteFusion Pro (Monthly)", 750_000,   "NGN", BillingInterval.Monthly, null),
        ("pro_yearly_ngn_v2",        "NoteFusion Pro (Yearly)",  6_000_000, "NGN", BillingInterval.Yearly, null),
        ("pro_monthly_usd",          "NoteFusion Pro (Monthly)", 999,       "USD", BillingInterval.Monthly, null),
        ("pro_yearly_usd",           "NoteFusion Pro (Yearly)",  7_900,     "USD", BillingInterval.Yearly, null),
        ("pro_monthly_usd_regional", "NoteFusion Pro (Monthly)", 499,       "USD", BillingInterval.Monthly, null),
        ("pro_yearly_usd_regional",  "NoteFusion Pro (Yearly)",  3_999,     "USD", BillingInterval.Yearly, null),
        ("one_song_ngn_v2",          "One song",                 300_000,   "NGN", BillingInterval.Single, null),
        ("one_song_usd",             "One song",                 199,       "USD", BillingInterval.Single, null),
        ("one_song_usd_regional_v3", "One song",                 199,       "USD", BillingInterval.Single, null),
        ("choir_monthly_ngn",          "NoteFusion Choir (Monthly)", 2_500_000,  "NGN", BillingInterval.Monthly, ChoirSeats),
        ("choir_yearly_ngn",           "NoteFusion Choir (Yearly)",  25_000_000, "NGN", BillingInterval.Yearly,  ChoirSeats),
        ("choir_monthly_usd",          "NoteFusion Choir (Monthly)", 1_999,      "USD", BillingInterval.Monthly, ChoirSeats),
        ("choir_yearly_usd",           "NoteFusion Choir (Yearly)",  19_900,     "USD", BillingInterval.Yearly,  ChoirSeats),
        ("choir_monthly_usd_regional", "NoteFusion Choir (Monthly)", 999,        "USD", BillingInterval.Monthly, ChoirSeats),
        ("choir_yearly_usd_regional",  "NoteFusion Choir (Yearly)",  9_900,      "USD", BillingInterval.Yearly,  ChoirSeats),
    ];

    /// <summary>Singers a choir plan seats besides the director.</summary>
    private const int ChoirSeats = 25;

    // Codes that must no longer be sold, for two different reasons. The two USD subscriptions are not merely
    // superseded, they are unpayable: Bachs subscriptions are card-only, this account has no USD card rail,
    // and their checkout renders an empty payment-method list — so leaving them active would offer an
    // international buyer two tiers that cannot complete. test_ngn_monthly was only ever a probe. pro_lifetime
    // is different: it was sellable and correct, just at $79, and lifetime is now $200 — which ships as
    // pro_lifetime_v2 rather than an edit, because a price is only traceable if it never moves under an
    // existing code. Retiring is a flag flip and not a delete, because fulfilment and every receipt read the
    // plan by id long after it stops being on sale, and a $79 buyer's receipt must keep saying $79.
    //
    // pro_lifetime_v2 and pro_yearly_ngn are retired the same way: lifetime is withdrawn as a product (an
    // existing lifetime subscription keeps its far-future period end and stays Pro), and the naira yearly
    // moved from ₦75,000 to ₦60,000, which ships as pro_yearly_ngn_v2 rather than an edit.
    //
    // one_song_usd_regional was $0.99, under Bachs' minimum checkout (1 USD; 100 NGN): every one of its checkouts
    // was refused before the payment page. It moved to $1.00 as one_song_usd_regional_v2, keeping the marker.
    //
    // No region sells a song for less than $1.99: the regional one song moved from $1.00 to $1.99 as
    // one_song_usd_regional_v3, and the naira one from ₦1,500 (about $1) to ₦3,000 as one_song_ngn_v2.
    private static readonly string[] RetiredCodes =
        ["pro_monthly", "pro_yearly", "test_ngn_monthly", "pro_lifetime", "pro_lifetime_v2", "pro_yearly_ngn",
         "one_song_usd_regional", "one_song_usd_regional_v2", "one_song_ngn"];

    private readonly IServiceProvider _services;
    private readonly ILogger<BillingSeeder> _logger;

    public BillingSeeder(IServiceProvider services, ILogger<BillingSeeder> logger)
    {
        _services = services;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var clock = scope.ServiceProvider.GetRequiredService<IDateTimeProvider>();

        // Runs after DatabaseSeeder has applied migrations (hosted services start in registration
        // order), so the schema is in place — same assumption the admin seeder makes.
        var seeded = 0;
        foreach (var (code, name, amountMinor, currency, interval, seats) in Plans)
        {
            var id = DeterministicId(code);
            if (await db.Plans.AnyAsync(p => p.Id == id, cancellationToken))
                continue;

            db.Plans.Add(Plan.Create(id, code, name, amountMinor, currency, interval, seats));
            seeded++;
        }

        // Matched on code rather than on the deterministic id, because a plan can also have been created by
        // hand against the live database — which is exactly what test_ngn_monthly was.
        var retired = await db.Plans
            .Where(p => p.IsActive && RetiredCodes.Contains(p.Code))
            .ToListAsync(cancellationToken);

        foreach (var plan in retired)
            plan.Retire();

        if (seeded > 0 || retired.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
            _logger.LogInformation(
                "Seeded {Seeded} billing plan(s), retired {Retired}.", seeded, retired.Count);
        }

        // Can what is on sale be paid for? Optional dependencies, because the seeder also runs in tests
        // that register no gateways; in the API they are always there.
        var gateways = scope.ServiceProvider.GetService<IPaymentGatewayFactory>();
        if (gateways is not null)
        {
            var active = await db.Plans.Where(p => p.IsActive).ToListAsync(cancellationToken);
            foreach (var problem in BillingReadiness.Check(active, gateways, scope.ServiceProvider.GetService<BachsOptions>()))
                _logger.LogError("Billing is not ready: {Problem}", problem);
        }

        var settings = scope.ServiceProvider.GetService<BillingSettings>();
        if (settings is not null && BillingReadiness.CheckCallbackUrl(settings.CheckoutCallbackUrl) is { } callbackProblem)
            _logger.LogWarning("Billing callback: {Problem}", callbackProblem);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private static Guid DeterministicId(string code)
    {
        using var md5 = System.Security.Cryptography.MD5.Create();
        var hash = md5.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"plan:{code}"));
        return new Guid(hash);
    }
}
