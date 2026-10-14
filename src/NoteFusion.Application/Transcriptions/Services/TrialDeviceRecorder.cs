using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Transcriptions.Services;

/// <summary>
/// Default <see cref="ITrialDeviceRecorder"/>: reads the country from the geo lookup, the address from the
/// request, the time from the clock, and stages the device row on the same context as the job it belongs to.
/// </summary>
public sealed class TrialDeviceRecorder : ITrialDeviceRecorder
{
    /// <summary>
    /// How many distinct accounts to identify before giving up counting. Only the log line and the
    /// decision to re-resolve a country depend on this number, so a cap costs nothing but the exactness of
    /// a figure that already means "more than a handset should have".
    /// </summary>
    private const int AccountScanLimit = 51;

    private readonly IApplicationDbContext _db;
    private readonly ICountryResolver _country;
    private readonly IClientIpAddress _clientIp;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<TrialDeviceRecorder> _logger;

    public TrialDeviceRecorder(
        IApplicationDbContext db,
        ICountryResolver country,
        IClientIpAddress clientIp,
        IDateTimeProvider clock,
        ILogger<TrialDeviceRecorder> logger)
    {
        _db = db;
        _country = country;
        _clientIp = clientIp;
        _clock = clock;
        _logger = logger;
    }

    public async Task RecordAsync(string fingerprint, Guid userId, CancellationToken ct = default)
    {
        var now = _clock.UtcNow;

        // Which accounts this device has generated from before. Read from the job rows rather than kept as
        // a counter here, because a counter cannot be made exact — A, then B, then A again is two accounts,
        // and an increment would say three. The job in flight is not committed yet, so this list is the
        // history and never includes the current submission.
        var accounts = await _db.TranscriptionJobs
            .Where(j => j.DeviceFingerprint == fingerprint)
            .Select(j => j.UserId)
            .Distinct()
            .Take(AccountScanLimit)
            .ToListAsync(ct);

        var accountIsNewHere = !accounts.Contains(userId);
        var otherAccounts = accounts.Count(id => id != userId);

        var device = await _db.TrialDevices.FirstOrDefaultAsync(d => d.Fingerprint == fingerprint, ct);

        if (device is null)
        {
            device = await RegisterAsync(fingerprint, now, ct);
        }
        else if (accountIsNewHere)
        {
            // A new account on a device that already has history is the one moment a second lookup is worth
            // paying for: it is exactly the case where "same phone, different account, different country"
            // says something. Every other submit reuses what we already know, which keeps lookup volume at
            // roughly one per device — the budget GeoSettings.LookupUrl documents, since the free provider
            // is metered per calling address and a dyno shares its egress with strangers.
            if (device.ObserveCountry(await ResolveCountryAsync(ct), now))
            {
                _logger.LogWarning(
                    "Trial device {Fingerprint} has moved country since it was first seen: {FirstCountry} → {CurrentCountry}.",
                    fingerprint, device.FirstSeenCountry, device.LastSeenCountry);
            }
        }
        else
        {
            device.Observe(now);
        }

        if (accountIsNewHere && otherAccounts > 0)
        {
            _logger.LogWarning(
                "Trial device {Fingerprint} is now generating for account {UserId}, having already generated "
                + "for {OtherAccountCount} other account(s). First seen {FirstSeenAtUtc:O} from {Country}. "
                + "The free-tier ceiling is shared across all of them.",
                fingerprint, userId, otherAccounts, device.FirstSeenAtUtc, device.FirstSeenCountry ?? "an unknown country");
        }
    }

    /// <summary>
    /// Inserts the handset's row at once, in its own save. Two accounts on one handset submitting together
    /// can both find no row; the unique index on the fingerprint refuses the second insert, and that used
    /// to surface as a 500 from the submit's own save. Here the loser detaches its row, reads the winner's
    /// and carries on as a returning device, so a submit never fails over bookkeeping.
    /// </summary>
    private async Task<TrialDevice> RegisterAsync(string fingerprint, DateTime now, CancellationToken ct)
    {
        var device = TrialDevice.Register(fingerprint, await ResolveCountryAsync(ct), _clientIp.Current, now);
        _db.TrialDevices.Add(device);
        try
        {
            await _db.SaveChangesAsync(ct);
            return device;
        }
        catch (DbUpdateException)
        {
            _db.TrialDevices.Entry(device).State = EntityState.Detached;
            var winner = await _db.TrialDevices.FirstOrDefaultAsync(d => d.Fingerprint == fingerprint, ct);
            if (winner is null)
                throw; // not the race: something else refused the row
            winner.ObserveCountry(device.FirstSeenCountry, now);
            return winner;
        }
    }

    /// <summary>
    /// The lookup never throws by contract, but it does reach a third party — and a device register is not
    /// worth failing a transcription over, so a country we could not get is simply a country we do not know.
    /// </summary>
    private async Task<string?> ResolveCountryAsync(CancellationToken ct)
    {
        try
        {
            return await _country.ResolveAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Country lookup failed while registering a trial device; recording it as unknown.");
            return null;
        }
    }
}
