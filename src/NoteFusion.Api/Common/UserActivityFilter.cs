using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using NoteFusion.Application.Activity;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Api.Common;

/// <summary>Records a successful GET in the activity log too (opening a sheet); GETs are left out otherwise.</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class RecordActivityAttribute : Attribute;

/// <summary>Keeps an action out of the activity log: one already recorded elsewhere, or a heartbeat that is not a choice.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class NoActivityAttribute : Attribute;

/// <summary>
/// The activity log's writer for signed-in requests: every POST, PUT, PATCH or DELETE an account makes that succeeds,
/// and the GETs marked <see cref="RecordActivityAttribute"/>, become one <see cref="UserActivity"/> row named
/// <c>controller.action</c> (<c>library.rename</c>), with the route's ids as detail and the client it came from.
/// </summary>
/// <remarks>
/// One filter rather than a line in each handler, so a new endpoint is recorded the day it ships and none is forgotten.
/// Never the body: what someone typed (a title, notes, a password) is not activity. The admin routes keep their own
/// audit log and are left out, as are the routes marked <see cref="NoActivityAttribute"/>. It writes after the response
/// has been produced, in its own small save, and a failure there is only logged: the log is never worth an error to the
/// person using the app.
/// </remarks>
public sealed class UserActivityFilter : IAsyncResultFilter
{
    private readonly ICurrentUser _user;
    private readonly IApplicationDbContext _db;
    private readonly IClientApp _client;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<UserActivityFilter> _logger;

    public UserActivityFilter(
        ICurrentUser user, IApplicationDbContext db, IClientApp client, IDateTimeProvider clock,
        ILogger<UserActivityFilter> logger)
    {
        _user = user;
        _db = db;
        _client = client;
        _clock = clock;
        _logger = logger;
    }

    public async Task OnResultExecutionAsync(ResultExecutingContext context, ResultExecutionDelegate next)
    {
        await next();

        if (_user.UserId is not { } userId || context.ActionDescriptor is not ControllerActionDescriptor action)
            return;
        var status = context.HttpContext.Response.StatusCode;
        if (status is < 200 or >= 300 || !Wanted(context.HttpContext.Request.Method, action))
            return;

        try
        {
            var name = ActivityNames.For(action.ControllerName, action.ActionName);
            var detail = string.Join(';', context.RouteData.Values
                .Where(v => v.Key is not ("controller" or "action") && v.Value is not null)
                .Select(v => $"{v.Key}={v.Value}"));
            _db.UserActivities.Add(UserActivity.Record(
                userId, name, detail.Length == 0 ? null : detail, ActivityClient.From(_client.Current), _clock.UtcNow));
            await _db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not record activity for {Controller}.{Action}", action.ControllerName, action.ActionName);
        }
    }

    private static bool Wanted(string method, ControllerActionDescriptor action)
    {
        if (action.ControllerName.StartsWith("Admin", StringComparison.Ordinal)
            || action.ControllerTypeInfo.IsDefined(typeof(NoActivityAttribute), inherit: true)
            || action.MethodInfo.IsDefined(typeof(NoActivityAttribute), inherit: true))
            return false;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method))
            return action.MethodInfo.IsDefined(typeof(RecordActivityAttribute), inherit: true);
        return !HttpMethods.IsOptions(method);
    }
}
