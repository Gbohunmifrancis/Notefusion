using NoteFusion.Application.Common;

namespace NoteFusion.Application.Analytics;

/// <summary>
/// "Reached the free limit", the one way the console counts it (Insights' path to paying, Growth's free-to-paid by
/// price set): every free transcription of some free week spent, counted as <c>TrialUsage</c> counts them — charged
/// jobs on the account, or on a handset the account submitted from (the gate refuses either), in the week they were
/// submitted in (<see cref="FreeTier.WeekStart"/>). Any week ever.
/// </summary>
public static class FreeLimitReach
{
    /// <summary>What the rule needs of one job: who, when, whether it spent an allowance, and from which handset.</summary>
    public sealed record JobTrace(Guid UserId, DateTime CreatedAtUtc, bool Charged, string? DeviceFingerprint);

    /// <summary>
    /// The test for one account over <paramref name="jobs"/>, which must hold the account's own jobs and every charged
    /// job on the handsets it used.
    /// </summary>
    public static Func<Guid, bool> Over(IReadOnlyCollection<JobTrace> jobs)
    {
        var charged = jobs.Where(j => j.Charged).ToList();
        var devicesOf = jobs.Where(j => j.DeviceFingerprint != null)
            .GroupBy(j => j.UserId)
            .ToDictionary(g => g.Key, g => g.Select(j => j.DeviceFingerprint!).ToHashSet(StringComparer.Ordinal));

        return id =>
        {
            var devices = devicesOf.GetValueOrDefault(id);
            return charged
                .Where(j => j.UserId == id || (j.DeviceFingerprint != null && devices?.Contains(j.DeviceFingerprint) == true))
                .GroupBy(j => FreeTier.WeekStart(j.CreatedAtUtc))
                .Any(week => week.Count() >= FreeTier.TrialGenerations);
        };
    }
}
