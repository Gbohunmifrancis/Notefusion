using System.Reflection;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Controllers;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Flags;
using NoteFusion.Application.Flags.Commands;
using NoteFusion.Application.Flags.Dtos;
using NoteFusion.Application.Flags.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using NSubstitute;

namespace NoteFusion.Tests.Flags;

/// <summary>
/// The season flag: on for everyone while switched on and before its last day is over (midnight West Africa Time after
/// it), on for an admin also while "Preview for admins only" is on — and never for anyone else because of the preview;
/// changed only by an admin, every change in the audit log; read anonymously at GET /api/app/season, cached a minute.
/// </summary>
public class SeasonFlagTests
{
    private static readonly DateTime Now = new(2026, 11, 20, 12, 0, 0, DateTimeKind.Utc);

    // ── The rules ────────────────────────────────────────────────────────────

    [Fact]
    public void On_for_everyone_while_switched_on_and_before_it_switches_itself_off()
    {
        var off = FeatureFlags.SwitchOffAtUtc(new DateOnly(2027, 1, 6));
        var flag = FeatureFlag.Create(FeatureFlag.Christmas, off, Now);
        Assert.False(flag.IsOn(Now)); // never changed: off

        flag.Set(true, false, off, Guid.NewGuid(), "admin@example.com", Now);
        Assert.True(flag.IsOn(Now));
        Assert.True(flag.IsOn(off.AddTicks(-1)));
        Assert.False(flag.IsOn(off));
        Assert.True(flag.SwitchedItselfOff(off));
        Assert.False(flag.IsOnFor(admin: true, off)); // no preview: an admin sees it end too

        flag.Set(true, false, null, Guid.NewGuid(), "admin@example.com", Now);
        Assert.True(flag.IsOn(Now.AddYears(5))); // no date: on until switched off
        Assert.False(flag.SwitchedItselfOff(Now.AddYears(5)));

        flag.Set(false, false, off, Guid.NewGuid(), "admin@example.com", Now);
        Assert.False(flag.IsOn(Now));
        Assert.False(flag.SwitchedItselfOff(off.AddDays(1)));
    }

    [Fact]
    public void The_preview_is_for_admins_only_and_ignores_the_switch_and_the_date()
    {
        var off = FeatureFlags.SwitchOffAtUtc(new DateOnly(2026, 11, 1)); // already gone
        var flag = FeatureFlag.Create(FeatureFlag.Christmas, off, Now);
        flag.Set(false, true, off, Guid.NewGuid(), "admin@example.com", Now);

        Assert.True(flag.IsOnFor(admin: true, Now));
        Assert.False(flag.IsOnFor(admin: false, Now));
        Assert.False(flag.IsOn(Now));
    }

    [Fact]
    public void The_season_ends_after_6_January_West_Africa_Time_and_defaults_to_the_next_one()
    {
        var off = FeatureFlags.SwitchOffAtUtc(new DateOnly(2027, 1, 6));
        Assert.Equal(new DateTime(2027, 1, 6, 23, 0, 0, DateTimeKind.Utc), off); // midnight in Lagos
        Assert.Equal(new DateOnly(2027, 1, 6), FeatureFlags.LastDay(off));

        Assert.Equal(new DateOnly(2027, 1, 6), FeatureFlags.DefaultLastDay(new DateOnly(2026, 10, 18)));
        Assert.Equal(new DateOnly(2027, 1, 6), FeatureFlags.DefaultLastDay(new DateOnly(2026, 12, 31)));
        Assert.Equal(new DateOnly(2027, 1, 6), FeatureFlags.DefaultLastDay(new DateOnly(2027, 1, 2)));
        Assert.Equal(new DateOnly(2027, 1, 6), FeatureFlags.DefaultLastDay(new DateOnly(2027, 1, 6)));
        Assert.Equal(new DateOnly(2028, 1, 6), FeatureFlags.DefaultLastDay(new DateOnly(2027, 1, 7)));

        // 23:30 UTC on 6 January is already 7 January in Lagos.
        Assert.Equal(new DateOnly(2027, 1, 7), FeatureFlags.Today(new DateTime(2027, 1, 6, 23, 30, 0, DateTimeKind.Utc)));
    }

    // ── GET /api/app/season ──────────────────────────────────────────────────

    [Fact]
    public async Task Nobody_sees_a_season_that_was_never_switched_on()
    {
        using var h = new TestHarness(Now);
        var admin = Seed(h, "admin@example.com", UserRole.Admin);

        Assert.False((await Season(h, new StubCurrentUser())).Christmas);
        Assert.False((await Season(h, Caller(admin))).Christmas);
    }

    [Fact]
    public async Task Switched_on_everyone_sees_it_until_its_last_day_is_over()
    {
        using var h = new TestHarness(Now);
        var singer = Seed(h, "singer@example.com");
        SetFlag(h, enabled: true, preview: false, lastDay: new DateOnly(2027, 1, 6));

        Assert.True((await Season(h, new StubCurrentUser())).Christmas);
        Assert.True((await Season(h, Caller(singer))).Christmas);

        h.Clock.UtcNow = new DateTime(2027, 1, 6, 22, 59, 0, DateTimeKind.Utc); // 23:59 on the 6th in Lagos
        Assert.True((await Season(h, new StubCurrentUser())).Christmas);
        h.Clock.UtcNow = new DateTime(2027, 1, 6, 23, 0, 0, DateTimeKind.Utc);
        Assert.False((await Season(h, new StubCurrentUser())).Christmas);
        Assert.False((await Season(h, Caller(singer))).Christmas);
    }

    [Fact]
    public async Task The_preview_shows_it_to_admins_only_and_a_token_alone_does_not_make_an_admin()
    {
        using var h = new TestHarness(Now);
        var admin = Seed(h, "admin@example.com", UserRole.Admin);
        var singer = Seed(h, "singer@example.com");
        var demoted = Seed(h, "was-admin@example.com");
        SetFlag(h, enabled: false, preview: true, lastDay: new DateOnly(2027, 1, 6));

        Assert.True((await Season(h, Caller(admin))).Christmas);
        Assert.False((await Season(h, Caller(singer))).Christmas);
        Assert.False((await Season(h, new StubCurrentUser())).Christmas);
        // A token minted while the account was an admin, read after it was demoted: the database has the last word.
        Assert.False((await Season(h, new StubCurrentUser(demoted.Id, UserRole.Admin, demoted.Email))).Christmas);

        // Pushes never read the preview.
        Assert.False(await FeatureFlags.ChristmasForEveryoneAsync(h.Db, h.Clock.UtcNow, default));
    }

    [Fact]
    public async Task The_season_answer_is_cached_a_minute_publicly_and_privately_with_a_token()
    {
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<GetSeasonQuery>(), Arg.Any<CancellationToken>()).Returns(Result.Success(new SeasonDto(true)));
        var controller = new AppController(new AppReleaseSettings(), sender)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        var ok = Assert.IsType<OkObjectResult>(await controller.Season(default));
        Assert.Equal(new SeasonDto(true), ok.Value);
        Assert.Equal("public, max-age=60", controller.Response.Headers.CacheControl.ToString());
        Assert.Equal("Authorization", controller.Response.Headers.Vary.ToString());

        var signedIn = new DefaultHttpContext();
        signedIn.Request.Headers.Authorization = "Bearer token";
        controller.ControllerContext = new ControllerContext { HttpContext = signedIn };
        await controller.Season(default);
        Assert.Equal("private, max-age=60", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public void The_season_is_anonymous_and_the_flag_routes_are_admin_only()
    {
        var season = typeof(AppController).GetMethod(nameof(AppController.Season))!;
        Assert.NotNull(season.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Equal("season", season.GetCustomAttribute<HttpGetAttribute>()!.Template);
        Assert.Equal("api/app", typeof(AppController).GetCustomAttribute<RouteAttribute>()!.Template);

        var admin = typeof(AdminFeaturesController);
        Assert.Equal(AuthorizationPolicies.Admin, admin.GetCustomAttribute<AuthorizeAttribute>()!.Policy);
        Assert.Equal("api/admin/features", admin.GetCustomAttribute<RouteAttribute>(inherit: false)!.Template);
        Assert.All(admin.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly),
            m => Assert.Null(m.GetCustomAttribute<AllowAnonymousAttribute>()));
        Assert.NotNull(admin.GetMethod(nameof(AdminFeaturesController.Get))!.GetCustomAttribute<HttpGetAttribute>());
        Assert.Equal("{key}", admin.GetMethod(nameof(AdminFeaturesController.Set))!.GetCustomAttribute<HttpPutAttribute>()!.Template);
    }

    // ── The console: GET/PUT /api/admin/features ─────────────────────────────

    [Fact]
    public async Task A_flag_never_changed_is_off_and_offers_the_next_6_January()
    {
        using var h = new TestHarness(Now);

        var flags = (await new GetFeatureFlagsQueryHandler(h.Db, h.Clock).Handle(new GetFeatureFlagsQuery(), default)).Value;
        Assert.Equal(["halloween", "christmas"], flags.Select(f => f.Key));
        var flag = flags.Single(f => f.Key == "christmas");

        Assert.Equal(("christmas", "Christmas season"), (flag.Key, flag.Name));
        Assert.False(flag.Enabled || flag.On || flag.AdminPreview || flag.SwitchedItselfOff);
        Assert.Equal(new DateOnly(2027, 1, 6), flag.AutoOffAt);
        Assert.Equal(new DateOnly(2027, 1, 6), flag.SuggestedAutoOffAt);
        Assert.Null(flag.UpdatedAtUtc);
        Assert.Null(flag.UpdatedByEmail);
    }

    [Fact]
    public async Task Turning_it_on_switches_it_off_after_the_next_6_January_and_is_written_to_the_audit_log()
    {
        using var h = new TestHarness(Now);
        var admin = Seed(h, "admin@example.com", UserRole.Admin);

        var flag = (await Set(h, admin, new SetFeatureFlagCommand("christmas", Enabled: true))).Value;

        Assert.True(flag.Enabled && flag.On);
        Assert.Equal(new DateOnly(2027, 1, 6), flag.AutoOffAt);
        Assert.Equal(new DateTime(2027, 1, 6, 23, 0, 0, DateTimeKind.Utc), flag.AutoOffAtUtc);
        Assert.Equal(("admin@example.com", h.Clock.UtcNow), (flag.UpdatedByEmail, flag.UpdatedAtUtc!.Value));
        var row = Assert.Single(h.Db.AdminAuditLogs.AsNoTracking());
        Assert.Equal(AdminAuditAction.SetFeatureFlag, row.Action);
        Assert.Equal(admin.Id, row.ActorUserId);
        Assert.Null(row.TargetUserId);
        Assert.Equal("Turned the Christmas season on for everyone.", row.Summary);
        Assert.True((await Season(h, new StubCurrentUser())).Christmas);
    }

    [Fact]
    public async Task Every_change_is_in_the_trail_in_words_and_a_save_that_changes_nothing_is_not()
    {
        using var h = new TestHarness(Now);
        var admin = Seed(h, "admin@example.com", UserRole.Admin);

        await Set(h, admin, new SetFeatureFlagCommand("christmas", Enabled: false, AdminPreview: false, AutoOff: true));
        Assert.Empty(h.Db.AdminAuditLogs.AsNoTracking()); // the defaults, saved: nothing changed
        Assert.Empty(h.Db.FeatureFlags.AsNoTracking());

        await Set(h, admin, new SetFeatureFlagCommand("christmas", AdminPreview: true));
        await Set(h, admin, new SetFeatureFlagCommand("christmas", AutoOffAt: new DateOnly(2027, 1, 2)));
        await Set(h, admin, new SetFeatureFlagCommand("christmas", AutoOff: false));
        await Set(h, admin, new SetFeatureFlagCommand("christmas", Enabled: true, AutoOff: true, AutoOffAt: new DateOnly(2027, 1, 6)));
        await Set(h, admin, new SetFeatureFlagCommand("christmas", Enabled: true)); // again: nothing changes
        await Set(h, admin, new SetFeatureFlagCommand("christmas", Enabled: false, AdminPreview: false));

        Assert.Equal(
            [
                "Turned the Christmas season preview for admins on.",
                "The Christmas season switches itself off after 2 Jan 2027.",
                "The Christmas season has no switch-off date: it stays on until someone switches it off.",
                "Turned the Christmas season on for everyone; it switches itself off after 6 Jan 2027.",
                "Turned the Christmas season off for everyone; turned the Christmas season preview for admins off.",
            ],
            h.Db.AdminAuditLogs.AsNoTracking().OrderBy(a => a.OccurredAtUtc).Select(a => a.Summary));
        var flag = await h.Db.FeatureFlags.AsNoTracking().SingleAsync();
        Assert.False(flag.Enabled || flag.AdminPreview);
        Assert.Equal(FeatureFlags.SwitchOffAtUtc(new DateOnly(2027, 1, 6)), flag.AutoOffAtUtc);
    }

    [Fact]
    public async Task Unticking_the_date_keeps_it_on_until_switched_off()
    {
        using var h = new TestHarness(Now);
        var admin = Seed(h, "admin@example.com", UserRole.Admin);

        var flag = (await Set(h, admin, new SetFeatureFlagCommand("christmas", Enabled: true, AutoOff: false))).Value;

        Assert.True(flag.On);
        Assert.Null(flag.AutoOffAt);
        Assert.Null(flag.AutoOffAtUtc);
        h.Clock.UtcNow = Now.AddYears(1);
        Assert.True((await Season(h, new StubCurrentUser())).Christmas);
    }

    [Fact]
    public async Task One_that_switched_itself_off_says_so_and_turning_it_on_again_moves_to_the_next_6_January()
    {
        using var h = new TestHarness(Now);
        var admin = Seed(h, "admin@example.com", UserRole.Admin);
        await Set(h, admin, new SetFeatureFlagCommand("christmas", Enabled: true));

        h.Clock.UtcNow = new DateTime(2027, 2, 1, 9, 0, 0, DateTimeKind.Utc);
        var flags = (await new GetFeatureFlagsQueryHandler(h.Db, h.Clock).Handle(new GetFeatureFlagsQuery(), default)).Value;
        var lapsed = flags.Single(f => f.Key == "christmas");
        Assert.True(lapsed.Enabled && lapsed.SwitchedItselfOff);
        Assert.False(lapsed.On);
        Assert.Equal(new DateOnly(2028, 1, 6), lapsed.SuggestedAutoOffAt);

        // Its preview or its date changed: still off for everyone (the console's switch reads Off).
        var previewed = (await Set(h, admin, new SetFeatureFlagCommand("christmas", AdminPreview: true))).Value;
        Assert.False(previewed.On || previewed.Enabled);
        Assert.Equal("Turned the Christmas season preview for admins on.",
            h.Db.AdminAuditLogs.AsNoTracking().OrderByDescending(a => a.OccurredAtUtc).First().Summary);

        var again = (await Set(h, admin, new SetFeatureFlagCommand("christmas", Enabled: true))).Value;
        Assert.True(again.On);
        Assert.Equal(new DateOnly(2028, 1, 6), again.AutoOffAt);
        Assert.Equal("Turned the Christmas season on for everyone; it switches itself off after 6 Jan 2028.",
            h.Db.AdminAuditLogs.AsNoTracking().OrderByDescending(a => a.OccurredAtUtc).First().Summary);
    }

    [Fact]
    public async Task A_new_date_for_a_season_that_ended_does_not_bring_it_back()
    {
        using var h = new TestHarness(Now);
        var admin = Seed(h, "admin@example.com", UserRole.Admin);
        await Set(h, admin, new SetFeatureFlagCommand("christmas", Enabled: true));
        h.Clock.UtcNow = new DateTime(2027, 2, 1, 9, 0, 0, DateTimeKind.Utc);

        var redated = (await Set(h, admin, new SetFeatureFlagCommand("christmas", AutoOff: true, AutoOffAt: new DateOnly(2027, 12, 31)))).Value;

        Assert.False(redated.On || redated.Enabled);
        Assert.Equal(new DateOnly(2027, 12, 31), redated.AutoOffAt);
        Assert.False((await Season(h, new StubCurrentUser())).Christmas);
        Assert.Equal("The Christmas season switches itself off after 31 Dec 2027.",
            h.Db.AdminAuditLogs.AsNoTracking().OrderByDescending(a => a.OccurredAtUtc).First().Summary);
    }

    [Fact]
    public async Task A_last_day_already_gone_and_a_flag_that_does_not_exist_are_refused()
    {
        using var h = new TestHarness(Now);
        var admin = Seed(h, "admin@example.com", UserRole.Admin);

        var passed = await Set(h, admin, new SetFeatureFlagCommand("christmas", Enabled: true, AutoOffAt: new DateOnly(2026, 11, 1)));
        Assert.Equal("FEATURE_FLAG_AUTO_OFF_PASSED", passed.Error.Code);
        Assert.Equal(ErrorType.Validation, passed.Error.Type);

        var unknown = await Set(h, admin, new SetFeatureFlagCommand("easter", Enabled: true));
        Assert.Equal("FEATURE_FLAG_UNKNOWN", unknown.Error.Code);
        Assert.Equal(ErrorType.NotFound, unknown.Error.Type);

        Assert.Empty(h.Db.FeatureFlags.AsNoTracking());
        Assert.Empty(h.Db.AdminAuditLogs.AsNoTracking());
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    internal static User Seed(TestHarness h, string email, UserRole role = UserRole.User)
    {
        var user = User.Create(email.Split('@')[0], email, "hash", Now.AddDays(-30));
        if (role == UserRole.Admin)
            user.PromoteToAdmin();
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    internal static StubCurrentUser Caller(User user) => new(user.Id, user.Role, user.Email, user.FullName);

    /// <summary>The flag as an admin would leave it, written straight to the table.</summary>
    internal static void SetFlag(TestHarness h, bool enabled, bool preview, DateOnly? lastDay)
    {
        var off = lastDay is { } day ? FeatureFlags.SwitchOffAtUtc(day) : (DateTime?)null;
        var flag = h.Db.FeatureFlags.FirstOrDefault(f => f.Key == FeatureFlag.Christmas);
        if (flag is null)
        {
            flag = FeatureFlag.Create(FeatureFlag.Christmas, off, h.Clock.UtcNow);
            h.Db.FeatureFlags.Add(flag);
        }
        flag.Set(enabled, preview, off, Guid.NewGuid(), "owner@example.com", h.Clock.UtcNow);
        h.Db.SaveChanges();
    }

    private static async Task<SeasonDto> Season(TestHarness h, StubCurrentUser caller)
        => (await new GetSeasonQueryHandler(h.Db, h.Clock, caller).Handle(new GetSeasonQuery(), default)).Value;

    private static Task<Result<FeatureFlagDto>> Set(TestHarness h, User admin, SetFeatureFlagCommand command)
    {
        h.Clock.UtcNow = h.Clock.UtcNow.AddSeconds(1); // the trail reads in order
        return new SetFeatureFlagCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock).Handle(command, default);
    }
}
