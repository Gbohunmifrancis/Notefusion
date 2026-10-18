using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using MediatR;
using NoteFusion.Application.Admin.ActivityAlerts;
using NoteFusion.Application.Admin.PaymentAlerts;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Push.Workers;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using NSubstitute;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// "Someone just signed up" and "someone is transcribing", on the admins' phones only: once each, never an admin's own,
/// never to a customer's phone, quiet in an admin's quiet hours, and without names when the phone asked for that.
/// </summary>
public class AdminActivityAlertTests
{
    /// <summary>18:42 in Lagos.</summary>
    private static readonly DateTime Now = new(2026, 10, 18, 17, 42, 0, DateTimeKind.Utc);

    private static readonly DateTime After = Now.AddSeconds(-35);

    // ── The words ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void One_sign_up_names_who_where_and_from()
    {
        var w = AdminActivityPushCopy.Summary([Signup("Ada Obi", "mobile", "GH")], [], hideNames: false);
        Assert.Equal("New sign-up", w.Title);
        Assert.Equal("Ada Obi just joined on the app, from Ghana.", w.Body);

        var web = AdminActivityPushCopy.Summary([Signup("Ada Obi", "web", null)], [], hideNames: false);
        Assert.Equal("Ada Obi just joined on the website.", web.Body);
    }

    [Fact]
    public void One_transcription_says_what_and_whether_it_is_the_first()
    {
        var id = Guid.NewGuid();
        var first = AdminActivityPushCopy.Summary([], [new TranscriptionFact(id, "Ada Obi", TranscriptionJobKind.Link, true)], false);
        Assert.Equal("First transcription", first.Title);
        Assert.Equal("Ada Obi is transcribing a song link.", first.Body);

        var again = AdminActivityPushCopy.Summary([], [new TranscriptionFact(id, "Ada Obi", TranscriptionJobKind.Upload, false)], false);
        Assert.Equal("Transcribing now", again.Title);
        Assert.Equal("Ada Obi is transcribing a recording.", again.Body);
    }

    [Fact]
    public void Joining_and_transcribing_in_one_run_is_one_line()
    {
        var s = Signup("Ada Obi", "mobile", "NG");
        var w = AdminActivityPushCopy.Summary([s], [new TranscriptionFact(s.UserId, "Ada Obi", TranscriptionJobKind.Upload, true)], false);
        Assert.Equal("New sign-up, transcribing", w.Title);
        Assert.Equal("Ada Obi just joined on the app and is transcribing a recording.", w.Body);
    }

    [Fact]
    public void Several_are_one_summary_and_names_can_be_left_out()
    {
        var signups = new[] { Signup("Ada Obi"), Signup("Tunde Bello") };
        var jobs = new[]
        {
            new TranscriptionFact(signups[0].UserId, "Ada Obi", TranscriptionJobKind.Upload, true),
            new TranscriptionFact(Guid.NewGuid(), "Chioma Eze", TranscriptionJobKind.Song, false),
            new TranscriptionFact(Guid.NewGuid(), "Kwame Mensah", TranscriptionJobKind.Link, false),
        };

        var w = AdminActivityPushCopy.Summary(signups, jobs, hideNames: false);
        Assert.Equal("2 sign-ups · 3 transcriptions", w.Title);
        Assert.Equal("Ada Obi, Tunde Bello and 2 others", w.Body);

        var hidden = AdminActivityPushCopy.Summary(signups, jobs, hideNames: true);
        Assert.Equal(AdminActivityPushCopy.HiddenBody, hidden.Body);
        Assert.Equal(AdminActivityPushCopy.HiddenBody, AdminActivityPushCopy.Summary([Signup("Ada Obi")], [], true).Body);
    }

    [Fact]
    public void A_long_name_still_fits_a_lock_screen()
    {
        var name = "Oluwaseunfunmilayo Adebayo-Ogunlesi Chukwuemeka Nwankwo-Okonkwo Babatunde";
        var w = AdminActivityPushCopy.Summary([Signup(name, "mobile", "ZA")], [], false);
        Assert.True(w.Body.Length <= AdminActivityPushCopy.BodyMax, w.Body);
        Assert.StartsWith("Oluwaseunfunmilayo", w.Body);
        Assert.True(w.Title.Length <= AdminActivityPushCopy.TitleMax);
    }

    // ── Who is told ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_sign_up_goes_to_admin_phones_alone_on_the_activity_channel()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        Device(h, admin, "ExponentPushToken[admin]");
        var ada = Customer(h, "Ada Obi", Now.AddSeconds(-10));
        Device(h, ada, "ExponentPushToken[ada]");

        var run = await Send(h);

        Assert.Equal(1, run.Signups);
        var (tokens, message) = Assert.Single(h.Push.DeviceSends);
        Assert.Equal(["ExponentPushToken[admin]"], tokens);
        Assert.Equal("New sign-up", message.Title);
        Assert.Equal(SendAdminActivityAlertsCommand.Channel, message.ChannelId);
        Assert.Equal("default", message.Sound);
        Assert.Equal("AdminUser", message.Data!["screen"]);
        Assert.Equal(ada.Id.ToString(), message.Data["userId"]);
    }

    [Fact]
    public async Task A_transcription_is_told_once_and_an_admins_own_never()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        Device(h, admin, "ExponentPushToken[admin]");
        var ada = Customer(h, "Ada Obi", Now.AddDays(-3));
        h.Db.TranscriptionJobs.Add(TranscriptionJob.RecordLink("job-old", ada.Id, Now.AddDays(-2), null, wasPro: false));
        h.Db.TranscriptionJobs.Add(TranscriptionJob.RecordLink("job-1", ada.Id, Now.AddSeconds(-8), null, wasPro: false));
        h.Db.TranscriptionJobs.Add(TranscriptionJob.Record("job-admin", admin.Id, Now.AddSeconds(-6)));
        h.Db.SaveChanges();

        var run = await Send(h);

        Assert.Equal((0, 1), (run.Signups, run.Transcriptions));
        var (_, message) = Assert.Single(h.Push.DeviceSends);
        Assert.Equal("Transcribing now", message.Title);
        Assert.Equal("Ada Obi is transcribing a song link.", message.Body);

        // The next window starts where this one ended: nothing is told twice.
        var next = await new SendAdminActivityAlertsCommandHandler(h.Db, h.Push, h.Clock, NullLogger<SendAdminActivityAlertsCommandHandler>.Instance)
            .Handle(new SendAdminActivityAlertsCommand(Now, Now.AddSeconds(30)), default);
        Assert.Equal(AdminActivityRun.Nothing, next.Value);
        Assert.Single(h.Push.DeviceSends);
    }

    [Fact]
    public async Task An_admins_own_sign_up_and_a_quiet_window_send_nothing()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        Device(h, admin, "ExponentPushToken[admin]");
        Admin(h, "second@notefusion.studio", Now.AddSeconds(-5));

        var run = await Send(h);

        Assert.Equal(AdminActivityRun.Nothing, run);
        Assert.Empty(h.Push.DeviceSends);
    }

    [Fact]
    public async Task Quiet_hours_and_a_mute_send_it_silent_and_names_stay_out_when_asked()
    {
        using var h = new TestHarness(new DateTime(2026, 10, 18, 22, 30, 0, DateTimeKind.Utc)); // 23:30 in Lagos
        var admin = Admin(h);
        Device(h, admin, "ExponentPushToken[night]", quietAtNight: true);
        Device(h, Admin(h, "other@notefusion.studio"), "ExponentPushToken[shared]", hideNames: true);
        Customer(h, "Ada Obi", h.Clock.UtcNow.AddSeconds(-10));

        await new SendAdminActivityAlertsCommandHandler(h.Db, h.Push, h.Clock, NullLogger<SendAdminActivityAlertsCommandHandler>.Instance)
            .Handle(new SendAdminActivityAlertsCommand(h.Clock.UtcNow.AddSeconds(-35), h.Clock.UtcNow), default);

        Assert.Equal(2, h.Push.DeviceSends.Count);
        var night = h.Push.DeviceSends.Single(s => s.Tokens.Contains("ExponentPushToken[night]")).Message;
        Assert.Equal(PaymentAlertChannels.Quiet, night.ChannelId);
        Assert.Null(night.Sound);
        var shared = h.Push.DeviceSends.Single(s => s.Tokens.Contains("ExponentPushToken[shared]")).Message;
        Assert.Equal(AdminActivityPushCopy.HiddenBody, shared.Body);
        Assert.Equal(SendAdminActivityAlertsCommand.Channel, shared.ChannelId);
    }

    [Fact]
    public async Task The_worker_moves_its_window_on_and_skips_what_happened_before_it_started()
    {
        var clock = new FixedClock(Now);
        var sender = Substitute.For<ISender>();
        var windows = new List<SendAdminActivityAlertsCommand>();
        sender.Send(Arg.Do<SendAdminActivityAlertsCommand>(windows.Add), Arg.Any<CancellationToken>())
            .Returns(Result.Success(AdminActivityRun.Nothing));
        var services = new ServiceCollection().AddSingleton(sender).BuildServiceProvider();
        var worker = new AdminActivityAlertWorker(
            services.GetRequiredService<IServiceScopeFactory>(), clock, NullLogger<AdminActivityAlertWorker>.Instance);

        clock.UtcNow = Now.AddSeconds(30);
        await worker.RunOnceAsync(default);
        clock.UtcNow = Now.AddSeconds(60);
        await worker.RunOnceAsync(default);

        Assert.Equal(2, windows.Count);
        Assert.Equal(Now - AdminActivityAlertWorker.Lag, windows[0].AfterUtc); // from when the API started
        Assert.Equal(windows[0].UntilUtc, windows[1].AfterUtc);
        Assert.Equal(Now.AddSeconds(60) - AdminActivityAlertWorker.Lag, windows[1].UntilUtc);
    }

    private static async Task<AdminActivityRun> Send(TestHarness h)
    {
        var result = await new SendAdminActivityAlertsCommandHandler(
                h.Db, h.Push, h.Clock, NullLogger<SendAdminActivityAlertsCommandHandler>.Instance)
            .Handle(new SendAdminActivityAlertsCommand(After, Now), default);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static SignupFact Signup(string name, string? source = null, string? country = null)
        => new(Guid.NewGuid(), name, source, country);

    private static User Admin(TestHarness h, string email = "admin@notefusion.studio", DateTime? createdAt = null)
    {
        var user = User.CreateAdmin("Francis", email, "hash", createdAt ?? Now.AddDays(-90));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static User Customer(TestHarness h, string name, DateTime createdAt)
    {
        var user = User.Create(name, $"{Guid.NewGuid():N}@example.com", "hash", createdAt);
        user.RecordSignupSource("mobile");
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void Device(
        TestHarness h, User user, string token, bool quietAtNight = false, bool hideNames = false)
    {
        var device = DeviceToken.Create(user.Id, token, "android", 42, Now.AddDays(-1));
        device.SetPaymentAlerts(true, PaymentAlertSounds.Chime, true, quietAtNight, hideNames, problems: true, Now.AddDays(-1));
        h.Db.DeviceTokens.Add(device);
        h.Db.SaveChanges();
    }
}
