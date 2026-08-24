namespace NoteFusion.Application.Admin.Dtos;

/// <summary>
/// One payment attempt as the reconciliation console lists it — every account's attempts in one table,
/// where <see cref="AdminPaymentDto"/> is the same row inside a single account's detail page.
/// </summary>
/// <remarks>
/// The account's email and name are carried on the row rather than fetched per row by the client: the
/// question this table answers is "whose payment is stuck", and a table that can only show a user id
/// cannot answer it without a request per line.
/// </remarks>
/// <param name="Status">
/// The <c>PaymentStatus</c> member's name. <c>Verified</c> is the one worth reading carefully: the money
/// moved but the ledger entry and subscription have not been written yet, so that row is a customer who
/// has paid and does not have Pro.
/// </param>
/// <param name="AmountMinor">Minor units of <paramref name="Currency"/> — cents for USD, kobo for NGN.</param>
/// <param name="IsStuck">
/// Still <c>Processing</c> after the reconciliation grace window, which is what the background sweep
/// looks for. Computed here from the same window the worker uses (see
/// <see cref="PaymentOpsSummaryDto.GraceWindowMinutes"/>) so the console and the worker cannot disagree
/// about which rows are overdue.
/// </param>
public sealed record AdminPaymentRowDto(
    Guid Id,
    Guid UserId,
    string UserEmail,
    string UserFullName,
    string Reference,
    string? ProviderReference,
    string Provider,
    string Status,
    long AmountMinor,
    string Currency,
    string? PlanName,
    string? FailureReason,
    bool IsStuck,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc);

/// <summary>
/// One payment in full, including the provider's own words about it.
/// </summary>
/// <remarks>
/// <paramref name="InitiateRaw"/> and <paramref name="VerifyRaw"/> are the raw gateway payloads the
/// transaction retained. They are here because they are the evidence in a dispute — what the provider
/// said, verbatim, rather than our reading of it — and there is nowhere else an operator can see them
/// short of a database session. Both are behind the admin policy, and neither is ever sent to a client.
/// <para>
/// The subscription this paid for is deliberately not repeated here; the row names the account, and the
/// account page already answers "did they end up with Pro".
/// </para>
/// </remarks>
/// <param name="IdempotencyKey">
/// Included because a duplicate-charge complaint is answered by it: two rows sharing this key would be
/// one initiation retried, and two rows with different keys are two real attempts.
/// </param>
public sealed record AdminPaymentDetailDto(
    AdminPaymentRowDto Payment,
    string IdempotencyKey,
    string? CheckoutUrl,
    string? InitiateRaw,
    string? VerifyRaw,
    IReadOnlyList<AdminLedgerEntryDto> Ledger,
    IReadOnlyList<AdminWebhookEventRowDto> WebhookEvents);

/// <summary>
/// One row of the webhook inbox — the record that makes provider callbacks exactly-once.
/// </summary>
/// <remarks>
/// The payload is not on the row: it is a whole request body per line, and the inbox table is read to
/// answer "did the callback arrive and did it drain", which the status and error fields answer on their
/// own. Fetch one event to read its payload.
/// </remarks>
/// <param name="Status">
/// <c>Received</c> means it is still queued or being retried, <c>Processed</c> that the effect was
/// applied once, <c>Failed</c> that the retries ran out and it is parked. A parked row does not mean the
/// customer lost their subscription — payment reconciliation recovers that independently — it means
/// nobody has looked at why it would not drain.
/// </param>
/// <param name="PaymentTransactionId">
/// Resolved from <paramref name="PaymentReference"/> so the console can link the event to the payment.
/// Null when the payload carried no reference of ours, or named one that no longer exists.
/// </param>
public sealed record AdminWebhookEventRowDto(
    Guid Id,
    string Provider,
    string ProviderEventId,
    string EventType,
    string? PaymentReference,
    Guid? PaymentTransactionId,
    string Status,
    int ProcessAttempts,
    string? LastError,
    DateTime ReceivedAtUtc,
    DateTime? LastAttemptAtUtc,
    DateTime? ProcessedAtUtc);

/// <summary>
/// One inbox row plus the request body it stored. Composed rather than a wider row so the paged list
/// does not have to carry payloads it never displays.
/// </summary>
/// <param name="Payload">
/// The provider's request body, verbatim. This is the field that explains a parked event: an error of
/// "reference not found" is only actionable next to the reference the provider actually sent.
/// </param>
public sealed record AdminWebhookEventDetailDto(
    AdminWebhookEventRowDto Event,
    string Payload);

/// <summary>
/// One ledger movement across all accounts, for the money-in/money-out page.
/// </summary>
/// <remarks>
/// Distinct from <see cref="AdminLedgerEntryDto"/>, which sits inside one account's page and therefore
/// does not need to say whose entry it is. This one names the account and the payment behind it, because
/// a global list of amounts with no owner cannot be reconciled against anything.
/// </remarks>
public sealed record AdminLedgerRowDto(
    Guid Id,
    Guid UserId,
    string UserEmail,
    Guid PaymentTransactionId,
    string? PaymentReference,
    string Direction,
    string Reason,
    long AmountMinor,
    string Currency,
    string Description,
    DateTime CreatedAtUtc);

/// <summary>
/// The reconciliation snapshot: what state the money is in right now, and what the background workers
/// are going to do about it.
/// </summary>
/// <remarks>
/// One request rather than five counters the console adds up itself, because the numbers have to be read
/// against each other — a stuck count means nothing without the window that defines "stuck", and a
/// parked-webhook count means nothing without knowing the sweep will recover the payment anyway.
/// </remarks>
/// <param name="VerifiedCount">
/// Payments where the money moved but the ledger entry and subscription have not been written. The most
/// important number on this page: every one of them is a customer who paid and cannot use what they
/// bought. It should normally be zero, and it is not self-healing — reconciliation only acts on rows still
/// in <c>Processing</c>, so a row parked here needs a developer.
/// </param>
/// <param name="StuckCount">
/// <c>Processing</c> rows older than <paramref name="GraceWindowMinutes"/> — exactly what the sweep
/// picks up. Non-zero is normal for a few minutes after the window; non-zero and not falling means the
/// sweep is not running or the provider is not answering.
/// </param>
/// <param name="OldestStuckSinceUtc">
/// When the oldest stuck payment was last touched, not an age in minutes: an age computed on the server
/// starts going stale the moment the response is cached, and this page caches.
/// </param>
/// <param name="WebhooksAwaitingCount">Inbox rows still queued or mid-retry.</param>
/// <param name="CreditedMinor">Sum of credits — money in. Gifts are absent by design: no payment, no entry.</param>
/// <param name="RefundedMinor">Sum of debits — money out.</param>
/// <param name="NetMinor">Credits minus debits, summed from the entries rather than stored anywhere.</param>
/// <param name="Currency">
/// Taken from the oldest entry, matching how the per-user balance is computed. Mixed-currency ledgers
/// would make this figure meaningless, and today every plan is priced in one currency.
/// </param>
/// <param name="GraceWindowMinutes">How long a payment may sit in <c>Processing</c> before it counts as stuck.</param>
/// <param name="SweepIntervalMinutes">How often the reconciliation worker looks. Printed so the page can say when the next pass is due.</param>
public sealed record PaymentOpsSummaryDto(
    int PendingCount,
    int ProcessingCount,
    int VerifiedCount,
    int CompletedCount,
    int FailedCount,
    int StuckCount,
    DateTime? OldestStuckSinceUtc,
    int WebhooksAwaitingCount,
    int WebhooksProcessedCount,
    int WebhooksFailedCount,
    DateTime? OldestAwaitingWebhookAtUtc,
    long CreditedMinor,
    long RefundedMinor,
    long NetMinor,
    string Currency,
    int GraceWindowMinutes,
    int SweepIntervalMinutes);

/// <summary>
/// What an operator-triggered reconciliation actually did.
/// </summary>
/// <remarks>
/// The underlying command is idempotent and answers "nothing to do" with success, which on its own gives
/// the console nothing to say. These three fields are the difference between "we asked and the provider
/// confirmed it" and "this was already settled" — both successes, and an operator chasing a support
/// ticket needs to know which one they got.
/// </remarks>
/// <param name="Changed">False when the payment was already in a state the sweep leaves alone.</param>
/// <param name="Outcome">A sentence written for the operator, ready to show as-is.</param>
public sealed record AdminReconcileResultDto(
    Guid PaymentTransactionId,
    string PreviousStatus,
    string Status,
    bool Changed,
    string Outcome);
