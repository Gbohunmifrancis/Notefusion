using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Flags;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice.Reminders;

/// <summary>An account due a practice reminder now, and which.</summary>
public sealed record ReminderCandidate(Guid UserId, string? TimeZone, DateOnly LocalDate, DueReminder Due, PracticeTrack? Track, bool Sound);

/// <summary>
/// The practice reminders: who is due one now (<see cref="FindDueAsync"/>) and sending it to their phones
/// (<see cref="SendAsync"/>), at most twice a local day, by the schedule in <see cref="PracticeReminderRules"/>
/// and in the words of <see cref="PracticeReminderCopy"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Phones only.</b> Reminders go by Expo push to the account's registered devices whose app code takes its
/// reminders from the server (<see cref="DeviceToken.ServerReminders"/>); older app code still schedules its own on
/// the phone, so those devices are skipped rather than reminded twice. Web push subscriptions are never sent
/// practice reminders. An account with no such device is skipped and leaves no row.
/// </para>
/// <para>
/// Respected: the account's reminder switch (<see cref="User.PracticeRemindersOn"/>, on by default once they have
/// practised or chosen a track), the app's push switch (turning notifications off unregisters the device, so it
/// is not here to send to), and the app's sound switch (synced to <see cref="User.PracticeReminderSound"/>: off
/// sends on the quiet Android channel with no iOS sound).
/// </para>
/// <para>
/// Every send is claimed by inserting its <see cref="PracticeReminder"/> row first; the unique (user, local date,
/// slot) index makes the second of two overlapping sweeps fail its insert and send nothing. A failed send is
/// retried once while the day is still unpractised and before the quiet hours.
/// </para>
/// <para>
/// While the Christmas season is on for everyone (<see cref="FeatureFlags"/>), the words come from a rotation its
/// festive lines have joined, naming the singer's next carol; timing, channels and limits are the same.
/// </para>
/// </remarks>
public sealed class PracticeReminderService
{
    /// <summary>The Android channel reminders sound on (created by the app, <c>mobile/src/lib/push.ts</c>).</summary>
    public const string AndroidChannel = "reminders";

    /// <summary>The Android channel for an account whose notification sound is off: same reminders, no sound.</summary>
    public const string AndroidQuietChannel = "reminders-quiet";

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IPushSender _push;
    private readonly IProviderHealth _health;

    public PracticeReminderService(IApplicationDbContext db, IDateTimeProvider clock, IPushSender push, IProviderHealth? health = null)
    {
        _db = db;
        _clock = clock;
        _push = push;
        _health = health ?? ProviderHealth.AlwaysAvailable;
    }

    /// <summary>
    /// True while Expo's breaker is open: every send now would be refused unsent, so the runner stops for this run
    /// rather than claiming reminders it cannot deliver.
    /// </summary>
    public bool ProviderUnavailable => _health.IsUnavailable(OutboundProviders.Push);

    /// <summary>Up to <paramref name="limit"/> accounts due a reminder now, those nearest their quiet hours first.</summary>
    public async Task<IReadOnlyList<ReminderCandidate>> FindDueAsync(int limit, CancellationToken ct)
    {
        if (limit <= 0)
            return [];

        var now = _clock.UtcNow;

        // Only accounts a reminder can reach: a phone on app code that takes server reminders. Switched off is out.
        var users = await _db.Users.AsNoTracking()
            .Where(u => u.IsActive
                        && u.PracticeRemindersOn != false
                        && _db.DeviceTokens.Any(t => t.UserId == u.Id && t.ServerReminders))
            .Select(u => new
            {
                u.Id,
                u.TimeZone,
                u.PracticeRemindersOn,
                u.PracticeReminderHour,
                u.PracticeReminderSound,
                u.PracticeRemindersSinceUtc,
                u.PracticeTrack,
                u.CreatedAt,
            })
            .ToListAsync(ct);
        if (users.Count == 0)
            return [];

        // Small per-account facts, read once and folded in memory (as the outreach sweep does), so the rules read
        // the same on Npgsql and on the tests' SQLite: one row per practised day, and the last two days' claims.
        var days = (await _db.PracticeSessions.AsNoTracking()
                .Where(s => _db.DeviceTokens.Any(t => t.UserId == s.UserId && t.ServerReminders))
                .Select(s => new { s.UserId, s.LocalDate })
                .Distinct()
                .ToListAsync(ct))
            .ToLookup(s => s.UserId, s => s.LocalDate);
        var claimsFrom = DateOnly.FromDateTime(now).AddDays(-2);
        var claims = (await _db.PracticeReminders.AsNoTracking()
                .Where(r => r.LocalDate >= claimsFrom)
                .Select(r => new { r.UserId, r.LocalDate, r.Slot, r.CreatedAtUtc })
                .ToListAsync(ct))
            .ToLookup(r => r.UserId);

        var due = new List<(ReminderCandidate Candidate, TimeOnly At)>();
        foreach (var u in users)
        {
            var practised = days[u.Id].ToHashSet();
            if (!PracticeReminderRules.IsOn(u.PracticeRemindersOn, practised.Count > 0, u.PracticeTrack is not null))
                continue;

            var zone = PracticeTime.Resolve(u.TimeZone);
            var localNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(now, DateTimeKind.Utc), zone);
            var today = DateOnly.FromDateTime(localNow);
            var claimedToday = claims[u.Id]
                .Where(c => c.LocalDate == today)
                .GroupBy(c => c.Slot)
                .ToDictionary(
                    g => g.Key,
                    g => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(g.Min(c => c.CreatedAtUtc), DateTimeKind.Utc), zone));

            var account = new ReminderAccount(
                practised,
                u.PracticeRemindersSinceUtc is { } since ? PracticeTime.LocalDate(since, zone) : null,
                PracticeTime.LocalDate(u.CreatedAt, zone),
                u.PracticeReminderHour);
            if (PracticeReminderRules.Due(account, localNow, claimedToday) is { } reminder)
            {
                due.Add((new ReminderCandidate(u.Id, u.TimeZone, today, reminder, u.PracticeTrack, u.PracticeReminderSound ?? true),
                    TimeOnly.FromDateTime(localNow)));
            }
        }

        return [.. due.OrderByDescending(d => d.At).Take(limit).Select(d => d.Candidate)];
    }

    /// <summary>
    /// Claims and sends <paramref name="candidate"/>'s reminder to every phone that takes server reminders. False
    /// when nothing was sent: no such phone any more, practised meanwhile, or another sweep claimed it first.
    /// </summary>
    public async Task<bool> SendAsync(ReminderCandidate candidate, CancellationToken ct)
    {
        var userId = candidate.UserId;
        var tokens = await PhonesAsync(userId, ct);
        if (tokens.Count == 0)
            return false;
        if (await _db.PracticeSessions.AnyAsync(s => s.UserId == userId && s.LocalDate == candidate.LocalDate, ct))
            return false;

        var due = candidate.Due;
        var christmas = await ChristmasAsync(ct);
        var words = PracticeReminderCopy.For(
            due.Kind, candidate.Track, due.Streak, PracticeReminderCopy.Rotation(userId, candidate.LocalDate, due.Slot),
            christmas, christmas ? await NextCarolAsync(userId, ct) : null);
        var now = _clock.UtcNow;
        var claim = PracticeReminder.Claim(
            userId, candidate.LocalDate, due.Slot, due.Kind, due.Streak, words.Title, words.Body, candidate.Sound, tokens.Count, now);
        _db.PracticeReminders.Add(claim);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Another sweep inserted the same (user, day, slot) first: theirs to send.
            _db.PracticeReminders.Remove(claim);
            return false;
        }

        var delivery = await _push.SendToDevicesAsync(tokens, Message(claim, LocalNow(candidate.TimeZone)), ct);
        if (delivery.Delivered)
            claim.MarkSent(tokens.Count, _clock.UtcNow);
        else if (delivery.NotAttempted)
            claim.MarkNotAttempted(delivery.Error);
        else
            claim.MarkFailed(tokens.Count, delivery.Error);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>Failed sends still due their one retry, oldest first.</summary>
    public async Task<IReadOnlyList<Guid>> FindRetriesAsync(int limit, CancellationToken ct)
    {
        if (limit <= 0)
            return [];
        var since = _clock.UtcNow - PracticeReminderRules.RetryWithin;
        return await _db.PracticeReminders.AsNoTracking()
            .Where(r => r.Status == PracticeReminderStatus.Failed && r.Attempts < PracticeReminder.MaxAttempts && r.CreatedAtUtc >= since)
            .OrderBy(r => r.CreatedAtUtc)
            .Take(limit)
            .Select(r => r.Id)
            .ToListAsync(ct);
    }

    /// <summary>
    /// Tries a failed send a second (and last) time, with the same words. Claimed by a conditional update on the
    /// attempt count, so two sweeps cannot both retry it. Not retried (and closed) when the reminder no longer makes
    /// sense: the account switched reminders off or removed its phones, practised, or the day or its sending hours
    /// are over.
    /// </summary>
    public async Task<bool> RetryAsync(Guid reminderId, CancellationToken ct)
    {
        var claimed = await _db.PracticeReminders
            .Where(r => r.Id == reminderId && r.Status == PracticeReminderStatus.Failed && r.Attempts < PracticeReminder.MaxAttempts)
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.Attempts, r => r.Attempts + 1)
                .SetProperty(r => r.Status, PracticeReminderStatus.Pending), ct);
        if (claimed != 1)
            return false;

        // Read without tracking and written back with a conditional update: the claim above went straight to the
        // database, so a tracked copy of this row would be stale.
        var row = await _db.PracticeReminders.AsNoTracking().FirstAsync(r => r.Id == reminderId, ct);
        var user = await _db.Users.AsNoTracking()
            .Where(u => u.Id == row.UserId && u.IsActive)
            .Select(u => new { u.TimeZone, u.PracticeRemindersOn })
            .FirstOrDefaultAsync(ct);
        var localNow = LocalNow(user?.TimeZone);
        var tokens = user is null ? new List<string>() : await PhonesAsync(row.UserId, ct);

        string? skipped =
            user is null || user.PracticeRemindersOn == false ? "Not retried: reminders are off for this account."
            : tokens.Count == 0 ? "Not retried: no phone takes server reminders now."
            : DateOnly.FromDateTime(localNow) != row.LocalDate || PracticeReminderRules.IsQuiet(TimeOnly.FromDateTime(localNow))
                ? "Not retried: the day's sending hours are over."
            : await _db.PracticeSessions.AnyAsync(s => s.UserId == row.UserId && s.LocalDate == row.LocalDate, ct)
                ? "Not retried: practised since."
            : null;

        var delivery = skipped is null
            ? await _push.SendToDevicesAsync(tokens, Message(row, localNow), ct)
            : PushDelivery.Failed(skipped);
        var now = _clock.UtcNow;
        var error = delivery.Error is null ? null : PracticeReminder.TrimError(delivery.Error);
        // Refused unsent by an open breaker: the attempt claimed above is handed back, so the reminder keeps its
        // retry for a run when Expo is answering.
        var giveBack = delivery.NotAttempted ? 1 : 0;
        await _db.PracticeReminders
            .Where(r => r.Id == reminderId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.Status, delivery.Delivered ? PracticeReminderStatus.Sent : PracticeReminderStatus.Failed)
                .SetProperty(r => r.SentAtUtc, delivery.Delivered ? now : (DateTime?)null)
                .SetProperty(r => r.Devices, tokens.Count)
                .SetProperty(r => r.Attempts, r => r.Attempts - giveBack)
                .SetProperty(r => r.Error, error), ct);
        return skipped is null && !delivery.NotAttempted;
    }

    /// <summary>
    /// The Christmas season, for everyone (a preview for admins never changes a push): read once per run, since the
    /// service is made for each run.
    /// </summary>
    private async Task<bool> ChristmasAsync(CancellationToken ct)
        => _christmas ??= await FeatureFlags.ChristmasForEveryoneAsync(_db, _clock.UtcNow, ct);

    private bool? _christmas;

    /// <summary>The carol of the account's next drill on the carols path, or null once all of them are sung.</summary>
    private async Task<string?> NextCarolAsync(Guid userId, CancellationToken ct)
    {
        var takes = await _db.PracticeSessions.AsNoTracking()
            .Where(s => s.UserId == userId && s.Kind == PracticeKind.Drill && s.DrillId != null && s.DrillId.StartsWith(CarolPath.CodePrefix))
            .Select(s => new { s.DrillId, s.Score })
            .ToListAsync(ct);
        return CarolPath.Next(CarolPath.Read(takes.Select(t => (t.DrillId, t.Score))))?.Carol;
    }

    /// <summary>The account's phones on app code that takes server reminders. Never its web push subscriptions.</summary>
    private Task<List<string>> PhonesAsync(Guid userId, CancellationToken ct)
        => _db.DeviceTokens
            .Where(t => t.UserId == userId && t.ServerReminders)
            .Select(t => t.Token)
            .ToListAsync(ct);

    private DateTime LocalNow(string? timeZone)
        => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(_clock.UtcNow, DateTimeKind.Utc), PracticeTime.Resolve(timeZone));

    /// <summary>
    /// The push: a tap opens Practice (<c>screen</c> is the mobile <c>notificationLink</c> allow-list). With sound,
    /// iOS plays the default sound and Android the reminder channel's; without, the quiet channel and no iOS sound.
    /// Held by Expo for an offline phone only until the quiet hours begin.
    /// </summary>
    public static PushMessage Message(PracticeReminder reminder, DateTime localNow) => new(
        reminder.Title,
        reminder.Body,
        new Dictionary<string, string> { ["screen"] = "Practice", ["reminder"] = reminder.Kind.ToString() },
        Sound: reminder.Sound ? "default" : null,
        ChannelId: reminder.Sound ? AndroidChannel : AndroidQuietChannel,
        TimeToLiveSeconds: PracticeReminderRules.TimeToLiveSeconds(localNow));
}
