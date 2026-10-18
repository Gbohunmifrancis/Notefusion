using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Billing;

/// <summary>
/// "Why checkouts end unpaid" for the console's Growth page: the checkouts opened in a window, by provider, from
/// opened to came back unpaid to answered; the answers to "What stopped you?"; what the provider's own page saw of
/// everyone who came back unpaid (closed quickly, declined, left after looking), read from the checkout and not from
/// the answers; and the latest "Something else" notes, without the account they came from.
/// </summary>
/// <remarks>
/// A window's checkouts and their returns are a few hundred narrow rows at most, so they are read once and folded in
/// memory for each provider, the way the rest of the Growth page reads payments. Customers only (AnalyticsScope).
/// </remarks>
public static class CheckoutExitReport
{
    /// <summary>Open for less than this, with nothing tried, is closed before Bachs had shown the ways to pay.</summary>
    public const int QuickSeconds = 20;

    /// <summary>The "Something else" notes listed, newest first.</summary>
    public const int NoteCount = 50;

    /// <summary>The provider filter's slices, in the console's order.</summary>
    private static readonly (string Name, PaymentProvider? Provider)[] Slices =
    [
        ("all", null),
        ("bachs", PaymentProvider.Bachs),
        ("paystack", PaymentProvider.Paystack),
    ];

    public static async Task<CheckoutExitsDto> BuildAsync(
        IApplicationDbContext db, DateTime fromUtc, DateTime toUtc, CancellationToken ct)
    {
        var opened = db.RealPayments()
            .Where(p => p.CreatedAtUtc >= fromUtc && p.CreatedAtUtc < toUtc && p.CheckoutUrl != null);

        var checkouts = await opened.AsNoTracking()
            .Select(p => new { p.Provider, p.Status, p.ProviderAttempt })
            .ToListAsync(ct);
        var exits = await db.CheckoutExits.AsNoTracking()
            .Join(opened, e => e.PaymentTransactionId, p => p.Id,
                (e, p) => new { p.Provider, p.ProviderAttempt, e.SecondsOpen, e.Reason, e.Note, e.AnsweredAtUtc })
            .ToListAsync(ct);

        var slices = Slices.Select(slice =>
        {
            var mine = checkouts.Where(c => slice.Provider is null || c.Provider == slice.Provider).ToList();
            var back = exits.Where(e => slice.Provider is null || e.Provider == slice.Provider).ToList();
            var quiet = back.Where(e => e.ProviderAttempt is null or CheckoutAttempt.None).ToList();
            return new CheckoutExitSliceDto(
                slice.Name,
                mine.Count,
                back.Count,
                back.Count(e => e.Reason is not null),
                mine.Count(c => c.Status == PaymentStatus.Completed),
                mine.Count(c => c.Status == PaymentStatus.Verified
                                || (c.Status == PaymentStatus.Processing && c.ProviderAttempt == CheckoutAttempt.TransferStarted)),
                [.. Enum.GetValues<CheckoutExitReason>()
                    .Select(r => new CheckoutExitReasonCountDto(r, back.Count(e => e.Reason == r)))],
                quiet.Count(e => e.SecondsOpen < QuickSeconds),
                back.Count(e => e.ProviderAttempt == CheckoutAttempt.Declined),
                quiet.Count(e => e.SecondsOpen >= QuickSeconds),
                back.Count(e => e.ProviderAttempt == CheckoutAttempt.TransferStarted));
        }).ToList();

        var notes = exits
            .Where(e => e.Reason == CheckoutExitReason.SomethingElse && !string.IsNullOrWhiteSpace(e.Note) && e.AnsweredAtUtc is not null)
            .OrderByDescending(e => e.AnsweredAtUtc)
            .Take(NoteCount)
            .Select(e => new CheckoutExitNoteDto(
                DateTime.SpecifyKind(e.AnsweredAtUtc!.Value, DateTimeKind.Utc),
                e.Provider.ToString().ToLowerInvariant(),
                e.Note!))
            .ToList();

        return new CheckoutExitsDto(QuickSeconds, slices, notes);
    }
}
