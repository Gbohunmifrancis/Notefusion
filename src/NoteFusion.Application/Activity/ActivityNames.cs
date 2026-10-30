using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Activity;

/// <summary>
/// The activity log's names and how the console reads them: a request's <c>controller.action</c>, the sign-ins the
/// server records itself, and the phone's own events (<see cref="AppEvent"/>), each as a short line ("Renamed a sheet").
/// A name with no line here is shown as it is, so a new endpoint is never hidden, only plainer until it is given one.
/// </summary>
public static class ActivityNames
{
    /// <summary>
    /// The phone's events too frequent to be news on the overview's short list (a screen opened, the app brought
    /// forward); the Activity page's feed and an account's journey still show every one.
    /// </summary>
    public static readonly string[] QuietAppEvents = ["screen_view", "app_foreground", "app_background", "app_open"];

    /// <summary>
    /// The phone's events the server records itself as well (a sign-in, a sheet renamed, deleted, shared or filed, a choir
    /// joined or left, a membership cancelled). The feeds show the server's row, the one that cannot be lost, and leave
    /// the phone's twin out so nothing is listed twice; an account's journey keeps both.
    /// </summary>
    public static readonly string[] ServerTwinAppEvents =
    [
        "sign_in", "sign_up", "sign_out", "sheet_renamed", "sheet_deleted", "sheet_shared", "sheet_unshared", "sheet_filed",
        "folder_shared", "choir_joined", "choir_left", "choir_member_removed", "membership_cancelled", "sheet_saved",
    ];

    /// <summary>The log's name for a request: <c>library.rename</c>.</summary>
    public static string For(string controller, string action) => $"{controller}.{action}".ToLowerInvariant();

    /// <summary>The line the console shows for a name, or null when it has none.</summary>
    public static string? Title(string name) => Titles.GetValueOrDefault(name);

    /// <summary>The console's line for a name, or the name itself made readable.</summary>
    public static string TitleOrName(string name) => Title(name) ?? name.Replace('_', ' ').Replace('.', ' ');

    /// <summary>
    /// A row's second line: how they signed in, the export's format, the screen, then where ("on the phone"). Route ids
    /// are left out (they mean nothing to a reader; the row's own link is the account), as are empty values.
    /// </summary>
    public static string? DetailLine(string? detail, string? client)
    {
        var parts = new List<string>();
        foreach (var (key, value) in AppEvent.ParseDetail(detail))
        {
            if (value.Length == 0 || key is "id" or "userId" or "jobId")
                continue;
            parts.Add(key switch
            {
                "method" => $"with {Method(value)}",
                "via" => $"from the {(value == "app" ? "app" : "website")}",
                _ => $"{key.Replace('_', ' ')}: {value}",
            });
        }
        if (client is "phone" or "web")
            parts.Add(client == "phone" ? "on the phone" : "on the web");
        return parts.Count == 0 ? null : string.Join(" · ", parts);
    }

    private static string Method(string value) => value switch
    {
        "password" => "a password",
        "google" => "Google",
        "passkey" => "a passkey",
        "email_code" => "the email code",
        _ => value.Replace('_', ' '),
    };

    private static readonly Dictionary<string, string> Titles = new(StringComparer.Ordinal)
    {
        // Signing in and the account (UserActivity, written by the server).
        [UserActivity.SignIn] = "Signed in",
        [UserActivity.SignUp] = "Created an account",
        [UserActivity.AccountDeleted] = "Deleted their account",
        ["auth.logout"] = "Signed out",
        ["auth.changepassword"] = "Changed their password",
        ["me.update"] = "Changed their name",
        ["me.updatepicture"] = "Changed their photo",
        ["me.removepicture"] = "Removed their photo",
        ["me.setemailpreferences"] = "Changed their email preferences",
        ["me.delete"] = "Deleted their account",
        ["account.delete"] = "Asked to delete their account",
        ["account.confirmdelete"] = "Deleted their account",
        ["passkeys.register"] = "Added a passkey",
        ["passkeys.rename"] = "Renamed a passkey",
        ["passkeys.delete"] = "Removed a passkey",
        ["devices.unregister"] = "Turned off push notifications",
        ["webpush.subscribe"] = "Turned on web notifications",
        ["webpush.unsubscribe"] = "Turned off web notifications",

        // Sheets.
        ["library.gettranscription"] = "Opened a sheet",
        ["library.rename"] = "Renamed a sheet",
        ["library.updatekey"] = "Changed a sheet's key",
        ["library.updatetempo"] = "Changed a sheet's tempo",
        ["library.updatetimesignature"] = "Changed a sheet's time signature",
        ["library.updatenotes"] = "Edited a sheet's notes",
        ["library.updatelyrics"] = "Edited a sheet's lyrics",
        ["library.updatefolder"] = "Moved a sheet to a folder",
        ["library.renamefolder"] = "Renamed a folder",
        ["library.sharefolder"] = "Shared a folder",
        ["library.unsharefolder"] = "Stopped sharing a folder",
        ["library.updateparts"] = "Saved SATB parts on a sheet",
        ["library.transpose"] = "Transposed a sheet",
        ["library.share"] = "Shared a sheet's link",
        ["library.unshare"] = "Stopped sharing a sheet",
        ["library.delete"] = "Deleted a sheet",
        ["transcriptions.linkinfo"] = "Looked up a song link",
        ["transcriptions.grade"] = "Sang a part back to be marked",
        ["transcriptions.transpose"] = "Transposed a sheet before saving",
        ["transcriptions.harmonise"] = "Asked for SATB parts",
        ["hymns.identify"] = "Hummed to find a hymn",
        ["preview.claim"] = "Kept their free preview",
        ["feedback.submit"] = "Sent feedback",

        // Choir.
        ["choirs.join"] = "Joined a choir",
        ["choirs.leave"] = "Left their choir",
        ["choirs.rename"] = "Renamed their choir",
        ["choirs.removemember"] = "Removed a singer from their choir",
        ["choirs.regenerateinvite"] = "Made a new choir invite code",
        ["choirs.share"] = "Shared a sheet with their choir",
        ["choirs.unshare"] = "Took a sheet out of the choir library",
        ["choirs.sheet"] = "Opened a choir sheet",

        // Practice.
        ["practice.gradedrill"] = "Sang a practice drill",
        ["practice.grademode"] = "Sang a practice exercise",
        ["practice.measurerange"] = "Measured their voice range",
        ["practice.rangesettings"] = "Changed where practice is placed",
        ["practice.settrack"] = "Chose a practice track",
        ["practice.setreminders"] = "Changed practice reminders",

        // Paying.
        ["billing.checkout"] = "Opened a checkout",
        ["billing.confirm"] = "Came back from a checkout",
        ["billing.checkoutexit"] = "Answered \"What stopped you?\"",
        ["billing.cancel"] = "Cancelled their membership",
        ["googleplaybilling.register"] = "Bought through Google Play",
        ["offers.click"] = "Opened an offer",

        // The phone app's own events (AppEvent; mobile lib/appEvents). The Listen events have their own page.
        ["app_open"] = "Opened the app",
        ["app_foreground"] = "Came back to the app",
        ["screen_view"] = "Opened a screen",
        ["sign_out"] = "Signed out",
        ["record_started"] = "Started recording",
        ["record_stopped"] = "Stopped recording",
        ["record_cancelled"] = "Threw a recording away",
        ["file_picked"] = "Picked a file to transcribe",
        ["link_submitted"] = "Sent a song link",
        ["recording_upload"] = "Sent a recording",
        ["take_queued_offline"] = "Kept a take to send later (offline)",
        ["take_sent_later"] = "A kept take was sent",
        ["take_retry"] = "Sent a take again",
        ["take_server_error"] = "A take hit a server error",
        ["take_refused"] = "A take was refused",
        ["take_job_lost"] = "A take's job was lost and resent",
        ["take_job_failed"] = "A take failed to transcribe",
        ["guest_preview_sent"] = "Sent a free preview",
        ["guest_preview_ready"] = "Free preview ready",
        ["beats_in_a_bar"] = "Chose beats in a bar",
        ["result_opened"] = "Opened a transcription",
        ["result_play"] = "Pressed play",
        ["sheet_saved"] = "Saved a sheet",
        ["sheet_renamed"] = "Renamed a sheet",
        ["sheet_deleted"] = "Deleted a sheet",
        ["sheet_shared"] = "Shared a sheet",
        ["sheet_unshared"] = "Stopped sharing a sheet",
        ["sheet_filed"] = "Moved a sheet to a folder",
        ["folder_shared"] = "Shared a folder",
        ["hymnbook_answered"] = "Answered \"Use the hymnbook version?\"",
        ["key_changed"] = "Changed the doh",
        ["sheet_transposed"] = "Transposed a sheet",
        ["offline_transpose"] = "Transposed a sheet offline",
        ["score_exported"] = "Exported a sheet",
        ["choir_invite_shared"] = "Shared the choir invite",
        ["choir_joined"] = "Joined a choir",
        ["choir_left"] = "Left their choir",
        ["choir_member_removed"] = "Removed a singer",
        ["paywall_viewed"] = "Looked at the plans",
        ["plan_selected"] = "Picked a plan",
        ["checkout_started"] = "Tapped Pay",
        ["checkout_opened"] = "Opened the payment page",
        ["checkout_returned"] = "Came back from the payment page",
        ["play_purchase_started"] = "Started a Google Play purchase",
        ["play_purchase_result"] = "Finished a Google Play purchase",
        ["play_purchase_registered"] = "Google Play purchase confirmed",
        ["purchases_restored"] = "Restored purchases",
        ["membership_cancelled"] = "Cancelled their membership",
        ["notification_tapped"] = "Tapped a notification",
        ["setting_changed"] = "Changed a setting",
        ["error_shown"] = "Was shown an error",
        ["feedback_sent"] = "Sent feedback",
        ["heard_about_answered"] = "Said where they heard of NoteFusion",
        ["hymn_opened"] = "Opened a hymn",
        ["hymn_pack_downloaded"] = "Downloaded the hymns",
        ["hymn_pack_removed"] = "Removed the hymns",
        ["offline_sheet_opened"] = "Opened a sheet offline",
        ["sheet_kept_offline"] = "Kept a sheet offline",
        ["sheet_unkept_offline"] = "Stopped keeping a sheet offline",
        ["offline_cache_cleared"] = "Cleared offline copies",
        ["practice_started"] = "Started Learn my part",
        ["practice_part"] = "Chose a part to learn",
        ["practice_balance"] = "Changed the parts' balance",
        ["practice_speed"] = "Changed the practice speed",
        ["practice_loop_set"] = "Looped some bars",
        ["practice_sing_locked"] = "Tapped Sing it back (Pro)",
        ["practice_take_started"] = "Sang their part back",
        ["practice_take_marked"] = "Got their part marked",
        ["practice_track_chosen"] = "Chose a practice track",
        ["drill_started"] = "Started a drill",
        ["drill_completed"] = "Finished a drill",
        ["practice_mode_opened"] = "Opened a practice mode",
        ["practice_mode_started"] = "Started a practice exercise",
        ["practice_mode_marked"] = "Got a practice exercise marked",
        ["warm_up_guide_played"] = "Played a warm-up guide",
        ["level_up"] = "Levelled up",
        ["badge_earned"] = "Earned a badge",
        ["carols_opened"] = "Opened the carols",
        ["carol_started"] = "Started a carol",
        ["carol_marked"] = "Got a carol marked",
        ["midnight_opened"] = "Opened the Midnight path",
        ["midnight_started"] = "Started a Midnight drill",
        ["midnight_marked"] = "Got a Midnight drill marked",
    };
}
