namespace NoteFusion.Application.Offers.Dtos;

// ── Public: GET /api/offers/current ─────────────────────────────────────────

/// <summary>
/// <c>GET /api/offers/current</c>: the offer live for this caller, if any, and whether the offer a link named has ended
/// for them. Mirrored by the web app's <c>assets/offer.js</c>.
/// </summary>
/// <param name="Offer">Null when nothing is live for this caller (naira prices, a Google Play member, outside the window, switched off).</param>
/// <param name="Ended">Set when <c>?key=</c> names an offer that started and is over for this caller: "The Halloween offer has ended."</param>
public sealed record CurrentOfferDto(LiveOfferDto? Offer, EndedOfferDto? Ended);

/// <param name="Label">"Halloween offer".</param>
/// <param name="LastDay">The last day it runs (<c>yyyy-mm-dd</c>).</param>
/// <param name="EndsAtUtc">The midnight after it in the caller's own time zone (the UK's when none is known).</param>
/// <param name="Plans">The caller's own set: each plan's usual price and the offer's.</param>
public sealed record LiveOfferDto(
    string Key,
    string Name,
    string Template,
    string Label,
    int PercentOff,
    DateOnly LastDay,
    DateTime EndsAtUtc,
    IReadOnlyList<OfferPlanPriceDto> Plans);

/// <param name="Interval">"Monthly" or "Yearly".</param>
public sealed record OfferPlanPriceDto(
    Guid PlanId, string Code, string Interval, string Currency, long AmountMinor, long OfferAmountMinor);

public sealed record EndedOfferDto(string Key, string Label);

// ── Console: /api/admin/offers ─────────────────────────────────────────────

/// <summary>One offer as the console's Offers page draws it (<c>GET /api/admin/offers</c>, and every write's answer).</summary>
/// <param name="State">"draft" (off), "scheduled" (on, not started), "running", or "ended" (over everywhere).</param>
/// <param name="Words">As stored: <c>{pct}</c> in them is written as the percent in the email (the preview shows it).</param>
/// <param name="WordsLocked">The email has been sent: the words are what went out.</param>
/// <param name="Plans">Every dollar Pro plan, before and after the percent, whether or not the offer includes it yet.</param>
/// <param name="Send">Null until Send is pressed.</param>
/// <param name="PostalAddressSet">Whether <c>Email__PostalAddress</c> is set; Send is refused until it is.</param>
/// <param name="CreatedBy">The creating admin's email.</param>
/// <param name="Label">"Halloween offer".</param>
/// <param name="EndsFirstUtc">Its end in the first time zone to reach midnight (UTC+14).</param>
/// <param name="EndsLastUtc">Its end in the last (UTC−12): from then on it has ended everywhere.</param>
/// <param name="SeasonOn">Whether its season (Feature flags) is on for everyone; while it is off the offer shows nowhere.</param>
public sealed record AdminOfferDto(
    Guid Id,
    string Key,
    string Name,
    string Template,
    int PercentOff,
    bool IncludesMonthly,
    bool IncludesYearly,
    DateTime StartsAtUtc,
    DateOnly LastDay,
    bool Enabled,
    string State,
    OfferWords Words,
    bool WordsLocked,
    IReadOnlyList<AdminOfferPlanDto> Plans,
    AdminOfferSendDto? Send,
    bool PostalAddressSet,
    string? CreatedBy,
    DateTime CreatedAtUtc,
    string Label,
    DateTime EndsFirstUtc,
    DateTime EndsLastUtc,
    bool SeasonOn,
    OfferWords? LastCallWords = null,
    DateTime? LastCallStartedAtUtc = null);

/// <param name="Interval">"Monthly" or "Yearly".</param>
/// <param name="Set">"standard" or "regional".</param>
public sealed record AdminOfferPlanDto(string Code, string Interval, string Set, long AmountMinor, long OfferAmountMinor);

public sealed record AdminOfferSendDto(
    DateTime StartedAtUtc, bool Paused, bool IncludesFree, bool IncludesLapsed, bool IncludesProNow);

/// <summary><c>GET /api/admin/offers/templates</c>: a template's defaults for the year ahead.</summary>
public sealed record OfferTemplateDto(
    string Template, string Name, string Label, DateTime StartsAtUtc, DateOnly LastDay, int PercentOff, OfferWords Words);

/// <summary><c>GET /api/admin/offers/{id}/preview</c>: the email exactly as the sender renders it.</summary>
public sealed record OfferPreviewDto(string Subject, string Preheader, string Html, string Text);

/// <summary><c>POST /api/admin/offers/{id}/test</c>: where the test went.</summary>
public sealed record OfferTestDto(string SentTo, string Set);

// ── Audience ────────────────────────────────────────────────────────────────

/// <summary><c>GET /api/admin/offers/{id}/audience</c>: who would get it, who never would and why, and the quota's pace.</summary>
/// <param name="Groups">Each group's size, ticked or not (the checkboxes' counts).</param>
/// <param name="Total">The ticked groups together.</param>
/// <param name="BySet">The ticked groups by price set.</param>
public sealed record OfferAudienceDto(
    OfferAudienceGroupsDto Groups,
    int Total,
    OfferAudienceSetsDto BySet,
    OfferAudienceExcludedDto Excluded,
    OfferQuotaDto Quota,
    OfferEstimateDto Estimate);

public sealed record OfferAudienceGroupsDto(int Free, int Lapsed, int ProNow);

public sealed record OfferAudienceSetsDto(int Standard, int Regional);

public sealed record OfferAudienceExcludedDto(int Naira, int NoCountry, int EmailOff, int StoreOrChoir, int RecentNote);

/// <summary>
/// The email quota as it bears on the offer (every kind of mail counts; optional mail stops at each window's line).
/// A limit is null when that window has no cap.
/// </summary>
/// <param name="DailyUsed">Emails of every kind in the last 24 hours.</param>
/// <param name="DailyOptionalLine">floor(daily limit × the optional share): optional mail stops there.</param>
/// <param name="MonthlyUsed">Emails of every kind in the last 31 days.</param>
/// <param name="RoomToday">Optional emails that can still go now: the tightest window's line less what it has sent.</param>
/// <param name="PerDay">
/// About how many go out in a full day at today's limits: the daily line less the day's other (non-offer) mail, so
/// the offer's own sends do not lower it; without a daily cap, what the other windows leave.
/// </param>
public sealed record OfferQuotaDto(
    int DailyUsed,
    int? DailyLimit,
    int? DailyOptionalLine,
    int MonthlyUsed,
    int? MonthlyLimit,
    int? MonthlyOptionalLine,
    int RoomToday,
    int PerDay);

/// <param name="Days">Days to send to everyone at <see cref="OfferQuotaDto.PerDay"/>; null when nothing can go.</param>
/// <param name="ReachedBeforeEnd">About how many are sent it before the offer's last day ends.</param>
public sealed record OfferEstimateDto(int? Days, int ReachedBeforeEnd);

// ── Progress ────────────────────────────────────────────────────────────────

/// <summary><c>GET /api/admin/offers/{id}/progress</c>: the email's queue, opens, clicks and what the offer sold.</summary>
/// <param name="Clicked">Emails whose button opened the web app.</param>
/// <param name="Bought">Completed payments at this offer's price, emailed or not (the banner and the pricing page sell it too).</param>
/// <param name="BoughtFromEmail">Of those, payments by accounts it was emailed to, after it was sent.</param>
/// <param name="Checkouts">Checkouts opened at this offer's price, paid or not.</param>
/// <param name="RevenueMinor">The completed payments' total, in US cents.</param>
/// <param name="ByDay">By UK calendar day.</param>
/// <param name="Opened">
/// Emails opened: their 1×1 image loaded, or their button clicked. Reads high, as Apple Mail loads every image on
/// delivery, and low where images are blocked.
/// </param>
public sealed record OfferProgressDto(
    int Queued,
    int Sent,
    OfferSkippedDto Skipped,
    int Failed,
    int Clicked,
    int Bought,
    int BoughtFromEmail,
    int Checkouts,
    long RevenueMinor,
    IReadOnlyList<OfferDayDto> ByDay,
    IReadOnlyList<OfferPlanSalesDto> ByPlan,
    int Opened,
    OfferLastCallProgressDto? LastCall = null);

/// <summary>
/// The last call's own queue and what came of it (null until it is sent); the progress's other counts are the email's.
/// <c>BoughtAfter</c>: bought at the offer's price after their last call went.
/// </summary>
public sealed record OfferLastCallProgressDto(int Queued, int Sent, int Skipped, int Failed, int Opened, int Clicked, int BoughtAfter);

/// <summary>
/// <c>GET /api/admin/offers/{id}/recipients</c>: the people an email went to, those who opened it first (the newest
/// open first), each with what came of it. <c>Total</c> counts every match, <c>Items</c> one page of them.
/// </summary>
public sealed record OfferRecipientsDto(string Round, string Filter, int Total, int Opened, IReadOnlyList<OfferRecipientDto> Items);

/// <param name="Group">"Lapsed", "Free" or "ProNow".</param>
/// <param name="Status">"Queued", "Sent", "Skipped" or "Failed"; <c>SkipReason</c> says why one was skipped.</param>
/// <param name="OpenedAtUtc">The first open: its image loading, or its button clicked with images blocked.</param>
/// <param name="BoughtAtUtc">When they paid at the offer's price, whichever email it followed.</param>
public sealed record OfferRecipientDto(
    Guid UserId,
    string? Name,
    string Email,
    string? Country,
    string Group,
    string Status,
    string? SkipReason,
    DateTime? SentAtUtc,
    DateTime? OpenedAtUtc,
    DateTime? ClickedAtUtc,
    DateTime? BoughtAtUtc);

/// <param name="LastCallInstead">Still waiting when the last call was sent, which went to them instead.</param>
public sealed record OfferSkippedDto(int OptedOut, int Bought, int BecamePro, int Ended, int NoLongerEligible, int LastCallInstead = 0);

public sealed record OfferDayDto(DateOnly Date, int Sent, int Clicked, int Bought, int Opened);

/// <param name="Set">"standard" or "regional".</param>
public sealed record OfferPlanSalesDto(string Code, string Name, string Set, int Count, long RevenueMinor);
