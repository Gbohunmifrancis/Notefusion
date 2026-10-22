using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Api.Common;
using NoteFusion.Api.Controllers;
using NoteFusion.Application.Activity;
using NoteFusion.Application.Activity.Queries;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.AppEvents.Commands;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Me.Commands;
using NoteFusion.Application.Web.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Activity;

/// <summary>
/// The server's own activity log (<see cref="UserActivity"/>): every sign-in, and every signed-in write the API answers
/// with success, recorded where it happens so no client can lose it; the phone's and the website's events stored once
/// however often they are sent; and the console's feeds reading all of it.
/// </summary>
public class UserActivityTests
{
    private static readonly DateTime Now = new(2026, 10, 22, 12, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- sign-ins

    [Fact]
    public async Task Every_sign_in_is_kept_with_how_and_from_where_and_a_refresh_is_not_one()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        h.MarkEmailVerified(user);
        var phone = new TokenIssuer(h.Jwt, h.Tokens, h.Db, h.Clock, h.Auth, new StubClientApp("app"));

        phone.IssueForSignIn(user, "google", newAccount: true);
        await h.Db.SaveChangesAsync();
        h.Clock.UtcNow = Now.AddHours(1);
        var login = await new LoginCommandHandler(h.Db, h.Hasher, h.TokenIssuer, h.Tokens, h.Clock, h.Country, h.Email, h.QuotaGate)
            .Handle(new LoginCommand(user.Email, "password123"), default);
        Assert.True(login.IsSuccess, login.IsFailure ? login.Error.Message : null);
        h.TokenIssuer.Issue(user); // a refresh, a password change: tokens, not a sign-in
        await h.Db.SaveChangesAsync();

        var rows = await h.Db.UserActivities.Where(a => a.UserId == user.Id).OrderBy(a => a.OccurredAtUtc).ThenBy(a => a.Name).ToListAsync();
        Assert.Equal(
            [(UserActivity.SignIn, "method=google", "phone"), (UserActivity.SignUp, "method=google", "phone"), (UserActivity.SignIn, "method=password", null)],
            rows.Select(r => (r.Name, r.Detail, r.Client)));
    }

    // ---------------------------------------------------------------- the filter

    [Fact]
    public async Task A_signed_in_write_that_succeeds_is_recorded_by_name_with_its_ids_and_never_its_body()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var sheet = Guid.NewGuid();

        await Run(h, user.Id, "PUT", 204, nameof(LibraryController.Rename), typeof(LibraryController), ("id", sheet));

        var row = await h.Db.UserActivities.SingleAsync();
        Assert.Equal(("library.rename", $"id={sheet}", "phone", Now), (row.Name, row.Detail, row.Client, row.OccurredAtUtc));
        Assert.Equal("Renamed a sheet", ActivityNames.Title(row.Name));
        Assert.Equal("on the phone", ActivityNames.DetailLine(row.Detail, row.Client));
    }

    [Fact]
    public async Task Failures_reads_anonymous_calls_admin_routes_and_marked_routes_are_not_recorded()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        await Run(h, user.Id, "PUT", 404, nameof(LibraryController.Rename), typeof(LibraryController));       // refused
        await Run(h, null, "PUT", 204, nameof(LibraryController.Rename), typeof(LibraryController));           // anonymous
        await Run(h, user.Id, "GET", 200, nameof(LibraryController.List), typeof(LibraryController));        // a read
        await Run(h, user.Id, "POST", 201, nameof(LibraryController.Save), typeof(LibraryController));          // [NoActivity]
        await Run(h, user.Id, "POST", 200, nameof(AdminController.GiftPro), typeof(AdminController)); // the audit log's
        Assert.Empty(await h.Db.UserActivities.ToListAsync());

        await Run(h, user.Id, "GET", 200, nameof(LibraryController.GetTranscription), typeof(LibraryController)); // [RecordActivity]
        Assert.Equal("library.gettranscription", (await h.Db.UserActivities.SingleAsync()).Name);
    }

    // ---------------------------------------------------------------- events stored once

    [Fact]
    public async Task A_phone_batch_sent_twice_is_stored_once()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var handler = new RecordAppEventsCommandHandler(h.Db, new StubCurrentUser(user.Id), h.Clock);
        AppEventInput[] batch =
        [
            new("result_opened", "source=fresh", Now.AddMinutes(-2), "k8f2a9c1x0"),
            new("sheet_saved", null, Now.AddMinutes(-1), "k8f2a9c1x1"),
            new("screen_view", "screen=Home", Now, null), // an older build sends no id: kept every time
        ];

        var first = await handler.Handle(new RecordAppEventsCommand(65, batch), default);
        var again = await handler.Handle(new RecordAppEventsCommand(65, batch), default);

        Assert.Equal((3, 3), (first.Value.Accepted, again.Value.Accepted));
        Assert.Equal(1, await h.Db.AppEvents.CountAsync(e => e.Name == "result_opened"));
        Assert.Equal(1, await h.Db.AppEvents.CountAsync(e => e.Name == "sheet_saved"));
        Assert.Equal(2, await h.Db.AppEvents.CountAsync(e => e.Name == "screen_view"));
    }

    [Fact]
    public async Task A_web_batch_sent_again_on_the_next_visit_is_stored_once_at_its_own_time()
    {
        using var h = new TestHarness(Now);
        var handler = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock);
        var threeDays = (int)TimeSpan.FromDays(3).TotalMilliseconds;
        WebEventInput[] batch = [new("action", "Saved sheet", "/app", null, null, "mobile", threeDays, null, "w0rdl3ss01")];

        await handler.Handle(new RecordWebEventsCommand("v1", "s1", batch), default);
        await handler.Handle(new RecordWebEventsCommand("v1", "s2", batch), default);

        var row = await h.Db.WebEvents.SingleAsync();
        Assert.Equal(Now.AddDays(-3), row.OccurredAtUtc);
    }

    [Fact]
    public async Task A_beacon_names_its_account_by_the_token_it_carries()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var handler = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock);

        await handler.Handle(new RecordWebEventsCommand("v1", "s1",
            [new WebEventInput("action", "Checkout opened", "/app", null, null, "desktop", null, null, "b3aconid01")], null, user.Id), default);

        Assert.Equal(user.Id, (await h.Db.WebEvents.SingleAsync()).UserId);
    }

    // ---------------------------------------------------------------- deletion and the feeds

    [Fact]
    public async Task Deleting_the_account_takes_its_activity_and_leaves_one_nameless_row()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        h.Db.UserActivities.Add(UserActivity.Record(user.Id, UserActivity.SignIn, "method=password", "web", Now.AddDays(-1)));
        h.Db.AppEvents.Add(AppEvent.TryCreate(user.Id, "screen_view", null, Now.AddDays(-1), null, 65, Now)!);
        await h.Db.SaveChangesAsync();

        var result = await new DeleteMyAccountCommandHandler(h.Db, h.Hasher, new StubGoogleTokenValidator(), new StubCurrentUser(user.Id), h.Clock)
            .Handle(new DeleteMyAccountCommand("password123", null), default);

        Assert.True(result.IsSuccess);
        Assert.Empty(await h.Db.AppEvents.ToListAsync());
        var left = await h.Db.UserActivities.SingleAsync();
        Assert.Equal((UserActivity.AccountDeleted, "via=app", (string?)null), (left.Name, left.Detail, left.Client));
    }

    [Fact]
    public async Task The_feed_shows_every_sign_in_what_the_server_saw_and_what_the_phone_did()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        h.Db.UserActivities.AddRange(
            UserActivity.Record(user.Id, UserActivity.SignIn, "method=google", "phone", Now.AddHours(-5)),
            UserActivity.Record(user.Id, UserActivity.SignIn, "method=password", "web", Now.AddHours(-3)),
            UserActivity.Record(user.Id, "library.delete", "id=abc", "web", Now.AddHours(-2)));
        h.Db.AppEvents.Add(AppEvent.TryCreate(user.Id, "export", "format=pdf", Now.AddHours(-1), null, 65, Now)!);
        await h.Db.SaveChangesAsync();

        var feed = (await new GetActivityFeedQueryHandler(h.Db).Handle(new GetActivityFeedQuery(), default)).Value;

        Assert.Equal(["app", "activity", "login", "login", "signup"], feed.Items.Select(i => i.Kind));
        Assert.Equal(("Deleted a sheet", "on the web"), (feed.Items[1].Title, feed.Items[1].Detail));
        Assert.Equal(("Signed in", "with Google · on the phone"), (feed.Items[3].Title, feed.Items[3].Detail));
        Assert.Equal("format: pdf · on the phone", feed.Items[0].Detail);

        var recent = (await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock).Handle(new GetAnalyticsOverviewQuery(), default))
            .Value.RecentActivity;
        Assert.Contains(recent, a => a.Kind == "login" && a.Detail == "signed in · with a password · on the web");
        Assert.Contains(recent, a => a.Kind == "activity" && a.Detail == "deleted a sheet · on the web");
        Assert.Contains(recent, a => a.Kind == "app");
    }

    // ---------------------------------------------------------------- helpers

    private static User Seed(TestHarness h)
    {
        var user = User.Create("Ada Obi", "ada@example.com", h.Hasher.Hash("password123"), Now.AddDays(-10));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    /// <summary>Runs the filter around one action as MVC would: the result produced, then the response's status read.</summary>
    private static async Task Run(
        TestHarness h, Guid? userId, string method, int status, string action, Type controller, params (string Key, object Value)[] route)
    {
        var http = new DefaultHttpContext();
        http.Request.Method = method;
        http.Response.StatusCode = status;
        var routeData = new RouteData();
        foreach (var (key, value) in route)
            routeData.Values[key] = value;
        var descriptor = new ControllerActionDescriptor
        {
            ControllerName = controller.Name.Replace("Controller", string.Empty),
            ActionName = action,
            MethodInfo = controller.GetMethods().First(m => m.Name == action),
            ControllerTypeInfo = controller.GetTypeInfo(),
        };
        var context = new ActionContext(http, routeData, descriptor);
        var executing = new ResultExecutingContext(context, [], new NoContentResult(), new object());
        var filter = new UserActivityFilter(
            new StubCurrentUser(userId), h.Db, new StubClientApp("app"), h.Clock, NullLogger<UserActivityFilter>.Instance);

        await filter.OnResultExecutionAsync(executing, () => Task.FromResult(new ResultExecutedContext(context, [], executing.Result, new object())));
    }
}
