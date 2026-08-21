namespace NoteFusion.Core.Enums;

/// <summary>
/// What an admin did. Stored as a string so a trail written today still reads correctly after this
/// enum gains members, and so a query can filter on the name without a lookup table.
/// </summary>
/// <remarks>
/// One member per operator-visible action, not per code path: the point of the trail is to answer
/// "who changed this account, when, and from where", so the granularity that matters is the one an
/// operator would recognise in a support thread.
/// </remarks>
public enum AdminAuditAction
{
    GiftPro = 1,
    RevokePro = 2,
    ExtendSubscription = 3,
    EndSubscription = 4,
    SuspendUser = 5,
    ReactivateUser = 6,
    CreateUser = 7,
    SendPasswordReset = 8,
    ChangeRole = 9
}
