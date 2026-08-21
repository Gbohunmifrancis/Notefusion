using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>
/// Errors from the admin console's write operations (module: admin). Separate from
/// <see cref="UserErrors"/> and <see cref="BillingErrors"/> because these are refusals aimed at an
/// operator, not at an end user: the message is what appears in the dashboard, so it says what to do
/// instead rather than apologising.
/// </summary>
public static class AdminErrors
{
    public static readonly Error NotAuthenticated =
        Error.Unauthorized("ADMIN_NOT_AUTHENTICATED", "You must be signed in as an administrator to do that.");

    /// <summary>
    /// Suspending or demoting your own account. Refused rather than allowed-with-a-warning: both actions
    /// end the session that is performing them, so the operator would be locked out mid-task with no way
    /// to undo it from the console.
    /// </summary>
    public static readonly Error CannotActOnSelf =
        Error.Failure("ADMIN_CANNOT_ACT_ON_SELF", "You cannot do that to your own account. Ask another administrator.");

    /// <summary>
    /// The action would leave no active administrator, which means nobody could sign in to reverse it.
    /// The only recovery from that state is a database session, so it is refused at the door.
    /// </summary>
    public static readonly Error LastAdmin =
        Error.Failure("ADMIN_LAST_ADMIN",
            "This is the only active administrator. Promote someone else first, then try again.");

    // ---------------------------------------------------------------- subscription operations

    public static readonly Error NoSubscription =
        Error.NotFound("ADMIN_NO_SUBSCRIPTION", "That account has never had a subscription.");

    /// <summary>
    /// Granting Pro to an account that already has it. Refused rather than layered, because one user has one
    /// subscription row: a second grant would overwrite the period they are currently on, which for a paying
    /// customer means quietly replacing what they bought. Extending is the action that means "give them more".
    /// </summary>
    public static readonly Error AlreadySubscribed =
        Error.Failure("ADMIN_ALREADY_SUBSCRIBED",
            "That account already has active Pro. Extend the current period instead of granting a new one.");

    /// <summary>
    /// Revoking a subscription somebody paid for, through the revoke-a-gift action. Its own code because the
    /// two actions are not interchangeable: cutting off a paying customer is a decision that needs its own
    /// confirmation, and it must not be reachable by clicking the button labelled "take the gift back".
    /// </summary>
    public static readonly Error PaidSubscriptionNotRevocable =
        Error.Failure("ADMIN_PAID_SUBSCRIPTION_NOT_REVOCABLE",
            "That subscription was paid for, so it is not a gift to take back. "
            + "End the subscription instead if it genuinely has to stop.");

    public static readonly Error LifetimeNotExtendable =
        Error.Failure("ADMIN_LIFETIME_NOT_EXTENDABLE", "Lifetime access never ends, so there is nothing to extend.");

    public static readonly Error ExtensionNotForward =
        Error.Failure("ADMIN_EXTENSION_NOT_FORWARD",
            "Pick a date in the future, past the current period end — an extension can only move access forward.");

    /// <summary>
    /// The requested end date reaches the far-future sentinel that means "lifetime". Refused so lifetime
    /// access is only ever granted by granting the lifetime plan, where it is visible as such.
    /// </summary>
    public static readonly Error ExtensionTooFar =
        Error.Failure("ADMIN_EXTENSION_TOO_FAR",
            "That date is so far out it reads as lifetime access. Grant the lifetime plan instead.");

    /// <summary>
    /// A gift attaches a real plan, so it needs one to exist. Distinct from
    /// <c>BillingErrors.PlanNotFound</c>, which is an end user asking for a plan that was retired: this is
    /// the seeded plan missing from the database, which is a deployment problem, not an operator mistake.
    /// </summary>
    public static Error GiftPlanMissing(string planCode) =>
        Error.Failure("ADMIN_GIFT_PLAN_MISSING",
            $"The plan this grant needs ({planCode}) is not in the database. Check that the billing seeder ran.");
}
