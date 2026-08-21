using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Admin.Queries;
using NoteFusion.Core.Enums;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Operational actions for the admin console (<c>web-admin/</c>): read one account in full, act on its
/// access and its subscription, and read the trail of everything that has been done.
/// </summary>
/// <remarks>
/// Gated on the Admin policy at the controller rather than per-action, matching
/// <see cref="AnalyticsController"/> — every route here either exposes one person's personal and payment
/// history or changes what they can do, and a new action added without an attribute would publish that to
/// any signed-in user.
/// <para>
/// Every mutation is a POST, including the ones that undo something. None of them are idempotent in the
/// HTTP sense worth honouring with PUT: each writes an audit row naming the operator who did it, so
/// "reactivate an already-active account" is still an event somebody chose to cause. The handlers refuse
/// or no-op as appropriate; the trail records the attempt either way.
/// </para>
/// <para>
/// The target account is always in the route and never in the body. A command carrying its own
/// <c>UserId</c> would let a mismatched body act on a different account than the URL names — which is the
/// one thing an audit trail cannot help with, because the row would be truthful about the wrong person.
/// </para>
/// </remarks>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin")]
public sealed class AdminController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminController(ISender sender) => _sender = sender;

    // ------------------------------------------------------------------- reading

    /// <summary>
    /// One account in full: profile, status, trial usage, current subscription, payment and ledger
    /// history, and the admin actions taken against it.
    /// </summary>
    /// <param name="id">The account to read.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <remarks>
    /// Named <c>Account</c> rather than <c>User</c> because <see cref="ControllerBase.User"/> is the
    /// caller's own principal, and shadowing it inside a controller that authorizes on the caller is a
    /// trap worth not setting.
    /// </remarks>
    [HttpGet("users/{id:guid}")]
    public async Task<IActionResult> Account(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetUserAccountQuery(id), ct));

    /// <summary>Every admin action taken, newest first.</summary>
    /// <param name="page">1-based page number. Out-of-range values are clamped.</param>
    /// <param name="pageSize">Rows per page, capped at 100.</param>
    /// <param name="action">Only this kind of action.</param>
    /// <param name="targetUserId">Only actions against this account.</param>
    /// <param name="search">Case-insensitive substring of actor email, target email or summary.</param>
    /// <param name="ct">Cancellation token.</param>
    [HttpGet("audit-log")]
    public async Task<IActionResult> AuditLog(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] AdminAuditAction? action = null,
        [FromQuery] Guid? targetUserId = null,
        [FromQuery] string? search = null,
        CancellationToken ct = default)
        => HandleResult(await _sender.Send(
            new GetAuditLogQuery(page, pageSize, action, targetUserId, search), ct));

    /// <summary>
    /// The state of every tier this stack can prove something about, plus the ones it cannot and why.
    /// </summary>
    /// <remarks>
    /// Always 200 while the API itself is up: a dependency being down is the answer, not a failure to
    /// answer, and a health page that 500s during an incident is a health page nobody can use.
    /// </remarks>
    [HttpGet("health")]
    public async Task<IActionResult> Health(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetSystemHealthQuery(), ct));

    // -------------------------------------------------------------- subscription

    /// <summary>
    /// Grants Pro at no charge for a month, a year, or for life. Records no payment and no ledger entry —
    /// a gift is not revenue — and is refused if the account already has an active subscription, because
    /// extending is the explicit action for that.
    /// </summary>
    [HttpPost("users/{id:guid}/gift-pro")]
    public async Task<IActionResult> GiftPro(Guid id, GiftBody body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new GiftProCommand(id, body.Duration, body.Note), ct));

    /// <summary>
    /// Takes a gift back, ending access now. Refused for a subscription somebody paid for: cutting off a
    /// paying customer is <c>subscription/end</c>, which is a separate and separately confirmed act.
    /// </summary>
    [HttpPost("users/{id:guid}/revoke-pro")]
    public async Task<IActionResult> RevokePro(Guid id, NoteBody? body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new RevokeProCommand(id, body?.Note), ct));

    /// <summary>Moves the end of the current period out. Charges nothing and takes no payment.</summary>
    [HttpPost("users/{id:guid}/subscription/extend")]
    public async Task<IActionResult> ExtendSubscription(Guid id, ExtendBody body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(
            new ExtendSubscriptionCommand(id, body.NewEndUtc, body.Note), ct));

    /// <summary>
    /// Ends a subscription now, gift or paid, forfeiting whatever remained of the period. Refunds nothing —
    /// money already taken is moved back through the provider, not through here.
    /// </summary>
    [HttpPost("users/{id:guid}/subscription/end")]
    public async Task<IActionResult> EndSubscription(Guid id, NoteBody? body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new EndSubscriptionCommand(id, body?.Note), ct));

    // ----------------------------------------------------------------- lifecycle

    /// <summary>
    /// Blocks an account from signing in and revokes its refresh tokens.
    /// </summary>
    /// <remarks>
    /// Not instant. An access token already in that account's hands keeps working until it expires, up to
    /// <c>Auth:AccessTokenMinutes</c> (60 by default) — there is no server-side session to tear down. The
    /// console states that window rather than implying the account is cut off the moment this returns.
    /// </remarks>
    [HttpPost("users/{id:guid}/suspend")]
    public async Task<IActionResult> Suspend(Guid id, NoteBody? body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new SuspendUserCommand(id, body?.Note), ct));

    /// <summary>Lets a suspended account sign in again. Their old refresh tokens stay revoked.</summary>
    [HttpPost("users/{id:guid}/reactivate")]
    public async Task<IActionResult> Reactivate(Guid id, NoteBody? body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new ReactivateUserCommand(id, body?.Note), ct));

    /// <summary>
    /// Promotes an account to Admin or demotes it back. Refused for your own account, and refused when it
    /// would leave the system with no active admin.
    /// </summary>
    [HttpPost("users/{id:guid}/role")]
    public async Task<IActionResult> Role(Guid id, RoleBody body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new SetUserRoleCommand(id, body.Role, body.Note), ct));

    /// <summary>
    /// Emails the account a password-reset link — the supported way to help someone locked out, because it
    /// puts the new password in their hands and not in an operator's.
    /// </summary>
    [HttpPost("users/{id:guid}/send-password-reset")]
    public async Task<IActionResult> SendPasswordReset(Guid id, NoteBody? body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new SendPasswordResetCommand(id, body?.Note), ct));

    // ------------------------------------------------------------------- bodies

    /// <summary>
    /// The operator's reason, carried by every action that has nothing else to say. Optional, and stored
    /// verbatim on the audit row: the trail can always show what happened, and this is the only place it
    /// can show why.
    /// </summary>
    public sealed record NoteBody(string? Note);

    /// <summary>How long the gift lasts. Maps to the real seeded plan for that interval.</summary>
    public sealed record GiftBody(BillingInterval Duration, string? Note);

    /// <summary>
    /// The new end of the current period, which must be later than the one it replaces. A date with no
    /// time lands at midnight UTC.
    /// </summary>
    public sealed record ExtendBody(DateTime NewEndUtc, string? Note);

    /// <summary>The role to leave the account in — not a direction, so the call is unambiguous on retry.</summary>
    public sealed record RoleBody(UserRole Role, string? Note);
}
