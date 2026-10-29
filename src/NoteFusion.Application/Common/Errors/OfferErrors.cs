using NoteFusion.Application.Offers;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Refusals from the seasonal offers: the console's Offers page, and the checkout's offer price.</summary>
public static class OfferErrors
{
    public static readonly Error NotFound =
        Error.NotFound("OFFER_NOT_FOUND", "There is no offer by that id.");

    public static readonly Error TemplateUnknown =
        Error.Validation("OFFER_TEMPLATE_UNKNOWN", "Choose the Halloween or the Christmas template.");

    public static readonly Error PercentOutOfRange =
        Error.Validation("OFFER_PERCENT_OUT_OF_RANGE",
            $"The percent off is {Offer.MinPercentOff} to {Offer.MaxPercentOff}.");

    public static readonly Error NoPlans =
        Error.Validation("OFFER_NO_PLANS", "Tick Pro Monthly, Pro Yearly or both.");

    public static readonly Error DatesInvalid =
        Error.Validation("OFFER_DATES_INVALID", "The last day must come after the start, and not have passed.");

    public static Error WordsInvalid(string message) => Error.Validation("OFFER_WORDS_INVALID", message);

    public static readonly Error NameInvalid =
        Error.Validation("OFFER_NAME_INVALID", $"Give the offer a name of at most {Offer.NameMaxLength} characters.");

    /// <summary>Its email has gone out: the words are what was sent.</summary>
    public static readonly Error WordsLocked =
        Error.Conflict("OFFER_WORDS_LOCKED", "The email has been sent, so its words can no longer change.");

    /// <summary>Running: only the last day may move, and only later.</summary>
    public static readonly Error Started =
        Error.Conflict("OFFER_STARTED",
            "This offer has started, so only its last day can change, and only to a later day.");

    public static readonly Error Overlaps =
        Error.Conflict("OFFER_OVERLAPS",
            "Another offer is on at the same time. One offer runs at a time: switch the other off or move its dates.");

    public static readonly Error Conflict =
        Error.Conflict("OFFER_CONFLICT", "Someone else changed this offer just now. Reload the page and try again.");

    public static readonly Error PostalAddressMissing =
        Error.Validation("OFFER_POSTAL_ADDRESS_MISSING",
            "Offer emails must carry the company's postal address. Set Email__PostalAddress on the server, then send.");

    public static readonly Error NotEnabled =
        Error.Conflict("OFFER_NOT_ENABLED", "Switch the offer on before sending its email.");

    public static readonly Error Ended =
        Error.Conflict("OFFER_ENDED", "This offer has ended.");

    public static readonly Error AlreadySent =
        Error.Conflict("OFFER_ALREADY_SENT", "This offer's email has already been sent.");

    public static readonly Error LastCallBeforeSend =
        Error.Conflict("OFFER_LAST_CALL_BEFORE_SEND", "The last call follows the offer's email. Send that first.");

    public static readonly Error LastCallSent =
        Error.Conflict("OFFER_LAST_CALL_SENT", "This offer's last call has already been sent.");

    /// <summary>Its last call has gone out: those words are what was sent.</summary>
    public static readonly Error LastCallWordsLocked =
        Error.Conflict("OFFER_LAST_CALL_WORDS_LOCKED", "The last call has been sent, so its words can no longer change.");

    public static readonly Error FilterUnknown =
        Error.Validation("OFFER_FILTER_UNKNOWN", "Show those who opened, clicked, bought, or all.");

    public static readonly Error RoundUnknown =
        Error.Validation("OFFER_ROUND_UNKNOWN", "Choose the offer's email or its last call.");

    public static readonly Error NoAudience =
        Error.Validation("OFFER_NO_AUDIENCE", "Nobody in the groups you ticked can be sent this offer.");

    public static readonly Error NotSent =
        Error.Conflict("OFFER_NOT_SENT", "This offer's email has not been sent, so there is nothing to pause.");

    public static readonly Error SetUnknown =
        Error.Validation("OFFER_SET_UNKNOWN", "Choose standard or regional prices.");

    public static readonly Error TestFailed =
        Error.Failure("OFFER_TEST_FAILED", "The test email could not be sent just now. Try again in a minute.");

    /// <summary>
    /// The checkout asked for an offer price the offer no longer gives this account (it ended where they are, was
    /// switched off, or never covered this plan): the client re-reads the offer and shows the usual prices.
    /// </summary>
    public static Error CheckoutOfferEnded(string? label)
        => Error.Conflict("BILLING_OFFER_ENDED",
            label is null
                ? "That offer has ended, so Pro is back to its usual price."
                : $"The {label} has ended, so Pro is back to its usual price.");

    /// <summary>The label for a template, for <see cref="CheckoutOfferEnded"/>: "Halloween offer".</summary>
    public static string? LabelFor(string? template) => OfferTemplates.Find(template)?.Label;
}
