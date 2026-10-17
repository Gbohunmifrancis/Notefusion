namespace NoteFusion.Application.Practice.Reminders;

/// <summary>
/// The practice reminder sweep (section <c>PracticeReminders</c>): <c>PracticeReminders__Enabled</c> (default true),
/// <c>PracticeReminders__IntervalMinutes</c> (10) and <c>PracticeReminders__BatchSize</c> (the most sends in one run,
/// retries included; 500). Only phones are reminded, through the configured push sender, so a deployment without
/// Expo (<c>Push__UseExpo</c>) logs them and sends nothing.
/// </summary>
public sealed class PracticeReminderSettings
{
    public bool Enabled { get; init; } = true;

    public int IntervalMinutes { get; init; } = 10;

    public int BatchSize { get; init; } = 500;
}
