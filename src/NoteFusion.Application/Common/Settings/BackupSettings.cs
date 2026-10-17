namespace NoteFusion.Application.Common.Settings;

/// <summary>
/// The backup alert (section <c>Backups</c>): <c>Backups__AlertsEnabled</c>, <c>Backups__ConsoleHealthUrl</c>.
/// The backups themselves are configured on the backup container (BACKUP_* settings), not here.
/// </summary>
public sealed class BackupSettings
{
    /// <summary>Push and email the admins when backups are late or failing. On by default.</summary>
    public bool AlertsEnabled { get; init; } = true;

    /// <summary>The admin console's System Health page, linked from the alert email.</summary>
    public string ConsoleHealthUrl { get; init; } = "https://admin.notefusion.studio/health";
}
