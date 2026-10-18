namespace NoteFusion.Application.Common.Settings;

/// <summary>
/// The email provider's sending caps (section <c>Email</c>): <c>Email__DailyLimit</c>, <c>Email__WeeklyLimit</c>,
/// <c>Email__MonthlyLimit</c>, <c>Email__OptionalShare</c>. The defaults are Resend's free plan (100 a day,
/// 3,000 a month, no weekly cap). Each limit is optional: a blank value keeps the default, zero or less turns
/// that window off. See <see cref="EmailBudget"/> for how they are applied.
/// </summary>
public sealed class EmailQuotaSettings
{
    /// <summary>Mail of every kind in the last 24 hours. Null: no daily cap.</summary>
    public int? DailyLimit { get; init; } = 100;

    /// <summary>Mail of every kind in the last 7 days. Null (the default): no weekly cap.</summary>
    public int? WeeklyLimit { get; init; }

    /// <summary>Mail of every kind in the last 31 days. Null: no monthly cap.</summary>
    public int? MonthlyLimit { get; init; } = 3000;

    /// <summary>
    /// Optional mail goes only while a window's count (all kinds) is under this share of its limit, so the
    /// rest is kept for essential mail. 0 holds every optional email; 1 lets optional mail run to the cap.
    /// </summary>
    public double OptionalShare { get; init; } = 0.6;
}
