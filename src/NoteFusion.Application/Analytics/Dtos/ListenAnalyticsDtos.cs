namespace NoteFusion.Application.Analytics.Dtos;

/// <summary>
/// The console's Listen from anywhere page for one window: who uses it and how, what each take became, how takes end
/// (stopped, the cap, the music stopping, nothing heard), the reminders, the settings people keep on, and the Pro locks
/// free accounts tap. Read off the phone's own first-party events (<c>AppEvent</c>) and the jobs the takes became.
/// </summary>
public sealed record ListenAnalyticsDto(
    DateTime FromUtc,
    DateTime ToUtc,
    ListenSummaryDto Summary,
    IReadOnlyList<ListenBreakdownDto> ByEntry,
    IReadOnlyList<ListenBreakdownDto> BySource,
    IReadOnlyList<ListenBreakdownDto> ByKind,
    IReadOnlyList<ListenCountDto> Endings,
    IReadOnlyList<ListenCountDto> Refusals,
    ListenSettingsDto Settings,
    IReadOnlyList<ListenDayDto> Days);

/// <param name="People">Accounts with any Listen from anywhere event in the window.</param>
/// <param name="ProPeople">Of those, accounts that started a take as Pro.</param>
/// <param name="TakesStarted">Takes that started recording.</param>
/// <param name="TakesSent">Takes handed to the send queue (a transcription will be charged when it finishes).</param>
/// <param name="TakesUnsent">Takes that ended without being sent: cancelled, too short, nothing heard, failed.</param>
/// <param name="Transcriptions">Jobs from sent takes that finished with a sheet.</param>
/// <param name="TranscriptionsFailed">Jobs from sent takes that closed without one.</param>
/// <param name="TranscriptionsPending">Jobs from sent takes still running, or not yet heard from.</param>
/// <param name="Reminders">"Still listening" reminders shown.</param>
/// <param name="StoppedFromReminder">Takes stopped or cancelled from a reminder's own buttons.</param>
/// <param name="EndedByThemselves">Takes ended by the cap, the music stopping or nothing heard: the forgotten ones.</param>
/// <param name="AverageSentSeconds">The average length of a sent take.</param>
/// <param name="CaptureBlocked">Takes where the playing app refused its sound and the room was used instead.</param>
/// <param name="ButtonHidden">Times the floating button was dragged onto the ×.</param>
/// <param name="NoticeDismissed">Times the Listen notification was swiped away.</param>
/// <param name="NoticeHidden">Times the Listen notification's Hide was tapped.</param>
/// <param name="BuySongTaps">Times "Buy one song" was tapped on the "none left" card.</param>
public sealed record ListenSummaryDto(
    int People,
    int ProPeople,
    int TakesStarted,
    int TakesSent,
    int TakesUnsent,
    int Transcriptions,
    int TranscriptionsFailed,
    int TranscriptionsPending,
    int Reminders,
    int StoppedFromReminder,
    int EndedByThemselves,
    int AverageSentSeconds,
    int CaptureBlocked,
    int ButtonHidden,
    int NoticeDismissed,
    int NoticeHidden,
    int BuySongTaps);

/// <summary>
/// One way in (<c>bubble</c>, <c>notification</c>, <c>tile</c>), source (<c>room</c>, <c>phone</c>) or "Listen for" kind
/// (<c>melody</c>, <c>poly</c>, <c>chords</c>; counted on the takes that ended, as what they were sent as).
/// </summary>
public sealed record ListenBreakdownDto(string Key, int Started, int Sent, int People);

/// <summary>A reason and how often: how takes ended (<c>Sent</c> of them sent), or why one could not start.</summary>
public sealed record ListenCountDto(string Key, int Count, int Sent);

/// <param name="ButtonOn">Accounts whose last word on the floating button, by the window's end, was on.</param>
/// <param name="NotificationOn">The same for Listen in notifications.</param>
/// <param name="TileAdded">Accounts that added the Listen tile.</param>
/// <param name="PhoneSound">Accounts whose last source choice was "This phone's sound".</param>
/// <param name="ProLockTaps">Taps on a Pro-locked row (button or notification) in the window.</param>
/// <param name="ProLockPeople">Accounts that tapped one.</param>
/// <param name="UpgradedAfterLock">Of those, accounts that paid for Pro or a choir within 7 days of their first tap.</param>
public sealed record ListenSettingsDto(
    int ButtonOn,
    int NotificationOn,
    int TileAdded,
    int PhoneSound,
    int ProLockTaps,
    int ProLockPeople,
    int UpgradedAfterLock);

/// <summary>One reporting day (WAT).</summary>
public sealed record ListenDayDto(DateOnly Date, int Started, int Sent, int People);
