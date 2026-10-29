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
    ChangeRole = 9,

    /// <summary>
    /// An operator asked the provider what happened to one payment, ahead of the sweep that would have
    /// asked anyway. Recorded even though it changes no account by itself, because the answer can: a
    /// verification that lands writes a ledger entry and a subscription, and the trail is where "who
    /// went looking, and when" has to be readable afterwards.
    /// </summary>
    ReconcilePayment = 10,

    /// <summary>An operator sent a custom email to an account.</summary>
    SendEmail = 11,

    /// <summary>An operator reset the free-trial usage on an account.</summary>
    ResetTrialQuota = 12,

    /// <summary>An operator set or cleared a global system broadcast announcement.</summary>
    SetAnnouncement = 13,

    /// <summary>An operator executed a pre-production purge of test users and data (the endpoint is gone; old rows keep it).</summary>
    PurgeTestData = 14,

    /// <summary>An operator marked an account as the team's own or a test account, or back to a customer.</summary>
    SetInternalAccount = 15,

    /// <summary>An operator put a blog post on the site (now or on a schedule).</summary>
    PublishBlogPost = 16,

    /// <summary>An operator took a blog post off the site, or cancelled its schedule.</summary>
    UnpublishBlogPost = 17,

    /// <summary>An operator archived a blog post.</summary>
    ArchiveBlogPost = 18,

    /// <summary>An operator deleted a blog post.</summary>
    DeleteBlogPost = 19,

    /// <summary>An operator asked the Gemini API for blog drafts.</summary>
    GenerateBlogDrafts = 20,

    /// <summary>An admin added a passkey to their own account.</summary>
    AddPasskey = 21,

    /// <summary>An admin removed one of their passkeys.</summary>
    RemovePasskey = 22,

    /// <summary>An admin signed in to the console with a passkey (actor and target are the same account).</summary>
    PasskeySignIn = 23,

    /// <summary>An admin changed a feature flag (the Christmas season): switched it, its admin preview or its end date.</summary>
    SetFeatureFlag = 24,

    /// <summary>An admin set Admin up on a phone (password, emailed code, then the phone's fingerprint or face).</summary>
    SetUpAdminPhone = 25,

    /// <summary>An admin created a seasonal offer (Money › Offers).</summary>
    CreateOffer = 26,

    /// <summary>An admin changed an offer's price, dates, name or email words.</summary>
    UpdateOffer = 27,

    /// <summary>An admin switched an offer on or off.</summary>
    SetOfferEnabled = 28,

    /// <summary>An admin pressed Send: the offer email was queued for its audience (the count is in the summary).</summary>
    SendOffer = 29,

    /// <summary>An admin sent the offer email to their own address as a test.</summary>
    SendOfferTest = 30,

    /// <summary>An admin paused or resumed an offer's sending.</summary>
    SetOfferSending = 31,

    /// <summary>An admin sent an offer's last call: the follow-up before it ends was queued (the count is in the summary).</summary>
    SendOfferLastCall = 32,

    /// <summary>An admin sent an offer's email (or its last call) as a notification too (the count is in the summary).</summary>
    SendOfferPush = 33
}
