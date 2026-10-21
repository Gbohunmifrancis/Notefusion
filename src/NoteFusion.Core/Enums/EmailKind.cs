namespace NoteFusion.Core.Enums;

/// <summary>
/// What an email is, recorded with every send (<see cref="Entities.EmailSend"/>) so the sending quota can
/// tell the mail an account needs from the mail it can do without (<c>EmailBudget.IsOptional</c>). Stored by
/// name.
/// </summary>
public enum EmailKind
{
    // Essential: always sent, whatever the quota says.

    /// <summary>The six-digit code that confirms a new account's address.</summary>
    Verification = 0,

    /// <summary>A password-reset link.</summary>
    PasswordReset = 1,

    /// <summary>Security notice: the password was changed.</summary>
    PasswordChanged = 2,

    /// <summary>Security notice: someone tried to register this address again.</summary>
    AccountAlreadyExists = 3,

    /// <summary>A receipt for a payment that was verified and fulfilled.</summary>
    Receipt = 4,

    /// <summary>A checkout the provider refused: the upgrade did not happen.</summary>
    PaymentFailed = 5,

    /// <summary>A paid membership ends within the week (once per period).</summary>
    SubscriptionExpiring = 6,

    /// <summary>
    /// Written for one case by a person or for the admins: an admin's message or inbox reply, the account
    /// deletion confirmations, the backup alert.
    /// </summary>
    Custom = 7,

    // Optional: held back when the quota is nearly used, so the essential mail above always has room.

    /// <summary>Welcome, once an account's address is confirmed.</summary>
    Welcome = 8,

    /// <summary>Confirmation of a place on the early-access waitlist.</summary>
    WaitlistConfirmation = 9,

    /// <summary>A Pro checkout left unfinished.</summary>
    CheckoutReminder = 10,

    /// <summary>Tips after a failed transcription.</summary>
    TranscriptionTips = 11,

    /// <summary>The founder's customer-research note.</summary>
    Outreach = 12,

    // Essential again, added later (the numbers are stored).

    /// <summary>The six-digit code that sets up or opens Admin on a phone.</summary>
    AdminCode = 13,

    /// <summary>Security notice: a phone was set up for Admin.</summary>
    AdminPhoneAdded = 14,

    /// <summary>Security notice: a passkey was added to an admin account.</summary>
    AdminPasskeyAdded = 15,

    // Optional again.

    /// <summary>A seasonal Pro offer (Halloween, Christmas): marketing mail, held by the quota like outreach.</summary>
    Offer = 16,
}
