using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using NoteFusion.Api.Common;
using NoteFusion.Application.Admin.PhoneLock;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Api.Auth;

/// <summary>
/// The phone's Admin must be unlocked (board f-admin/10 revised): a request whose access token was issued to the app
/// (<see cref="ClientKinds.App"/>) needs an open pass in <see cref="AdminPhoneLockRules.Header"/>, which only the
/// phone's fingerprint-locked key or the password plus an emailed code can open. A token taken off the phone is no use
/// without it. Browser tokens are not asked yet.
/// </summary>
public sealed class UnlockedPhoneRequirement : IAuthorizationRequirement;

/// <summary>An admin route the phone may call while Admin is locked: the lock's own, and "Mute 1 hour".</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class AllowLockedPhoneAttribute : Attribute;

/// <summary>
/// A destructive admin action (Suspend, End subscription, Revoke Pro, Change role, a flag): from the phone it wants a
/// fingerprint (or, with no sensor, the password) within <see cref="AdminPhoneLockRules.FreshFor"/>.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class FreshPhoneUnlockAttribute : Attribute;

public sealed class UnlockedPhoneHandler : AuthorizationHandler<UnlockedPhoneRequirement>
{
    private readonly IAdminPhoneLock _lock;
    private readonly IHttpContextAccessor _http;
    private readonly IDateTimeProvider _clock;

    public UnlockedPhoneHandler(IAdminPhoneLock phoneLock, IHttpContextAccessor http, IDateTimeProvider clock)
    {
        _lock = phoneLock;
        _http = http;
        _clock = clock;
    }

    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, UnlockedPhoneRequirement requirement)
    {
        if (context.User.FindFirst(ClientKinds.Claim)?.Value != ClientKinds.App)
        {
            context.Succeed(requirement);
            return Task.CompletedTask;
        }

        var http = _http.HttpContext;
        var endpoint = http?.GetEndpoint();
        if (endpoint?.Metadata.GetMetadata<AllowLockedPhoneAttribute>() is not null)
        {
            context.Succeed(requirement);
            return Task.CompletedTask;
        }

        var now = _clock.UtcNow;
        var token = http?.Request.Headers[AdminPhoneLockRules.Header].ToString();
        if (ActiveAccountChecks.UserIdOf(context.User) is not { } userId
            || _lock.Touch(token, userId, now) is not { } session)
        {
            context.Fail(new AuthorizationFailureReason(this, AdminPhoneLockErrors.Locked.Code));
            return Task.CompletedTask;
        }

        if (endpoint?.Metadata.GetMetadata<FreshPhoneUnlockAttribute>() is not null
            && now - session.UnlockedAtUtc > AdminPhoneLockRules.FreshFor)
        {
            context.Fail(new AuthorizationFailureReason(this, AdminPhoneLockErrors.ConfirmRequired.Code));
            return Task.CompletedTask;
        }

        context.Succeed(requirement);
        return Task.CompletedTask;
    }
}

/// <summary>
/// Says why a phone was turned away (<c>ADMIN_LOCKED</c>, <c>ADMIN_CONFIRM_REQUIRED</c>) in the API's own error shape,
/// so the app locks Admin or asks for the fingerprint rather than showing a bare 403. Every other outcome is the
/// framework's.
/// </summary>
public sealed class UnlockedPhoneResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public async Task HandleAsync(
        RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
    {
        var reason = authorizeResult.Forbidden
            ? authorizeResult.AuthorizationFailure?.FailureReasons.FirstOrDefault(r => r.Handler is UnlockedPhoneHandler)
            : null;
        if (reason is null)
        {
            await _default.HandleAsync(next, context, policy, authorizeResult);
            return;
        }

        var error = reason.Message == AdminPhoneLockErrors.ConfirmRequired.Code
            ? AdminPhoneLockErrors.ConfirmRequired
            : AdminPhoneLockErrors.Locked;
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new ApiError(error.Code, error.Message));
    }
}
