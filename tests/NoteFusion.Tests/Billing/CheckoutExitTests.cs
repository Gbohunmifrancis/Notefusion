using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Billing.Gateways;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// "What stopped you?": a client reports coming back from its checkout unpaid, then the one-tap answer; the API reads
/// what the provider's page saw of the customer whenever it verifies the session; the Growth page reads it all back.
/// The hazards worth pinning: asking twice, recording someone else's checkout, a paid checkout looking abandoned, and
/// the provider signal ever touching fulfilment.
/// </summary>
public class CheckoutExitTests
{
    private static readonly DateTime Now = new(2026, 10, 18, 12, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- the entities

    [Fact]
    public void The_strongest_signal_the_page_has_shown_is_kept()
    {
        var tx = PaymentTransaction.Create(Guid.NewGuid(), Guid.NewGuid(), PaymentProvider.Bachs, "checkout:NF_a", "NF_a", 999, "USD", Now);

        Assert.Null(tx.ProviderAttempt);
        Assert.True(tx.RecordProviderAttempt(CheckoutAttempt.None));
        Assert.True(tx.RecordProviderAttempt(CheckoutAttempt.Declined));
        Assert.True(tx.RecordProviderAttempt(CheckoutAttempt.TransferStarted));

        // A later, weaker reading (the transfer's charge settled into a failed retry, an open page read again) never
        // takes a stronger one back.
        Assert.False(tx.RecordProviderAttempt(CheckoutAttempt.Declined));
        Assert.False(tx.RecordProviderAttempt(CheckoutAttempt.None));
        Assert.Equal(CheckoutAttempt.TransferStarted, tx.ProviderAttempt);
    }

    [Fact]
    public void Recording_the_signal_is_not_a_transition_and_leaves_the_checkouts_own_dates_alone()
    {
        // UpdatedAtUtc dates the checkout's transitions: the 30-minute reuse window and the recently-failed window
        // read it. An observation moving it would hand out a dead session or ask about an old one.
        var tx = PaymentTransaction.Create(Guid.NewGuid(), Guid.NewGuid(), PaymentProvider.Bachs, "checkout:NF_b", "NF_b", 999, "USD", Now);
        tx.AttachCheckout("chk_b", "https://pay.test/b", "{}", Now);

        tx.RecordProviderAttempt(CheckoutAttempt.Declined);

        Assert.Equal(Now, tx.UpdatedAtUtc);
        Assert.Equal(PaymentStatus.Processing, tx.Status);
    }

    [Fact]
    public void An_answer_is_taken_once_and_its_note_trimmed()
    {
        var exit = CheckoutExit.Record(Guid.NewGuid(), Guid.NewGuid(), 42, Now);

        Assert.True(exit.Answer(CheckoutExitReason.SomethingElse, "  I wanted to pay with PayPal  ", Now));
        Assert.False(exit.Answer(CheckoutExitReason.JustLooking, null, Now.AddMinutes(1)));

        Assert.Equal(CheckoutExitReason.SomethingElse, exit.Reason);
        Assert.Equal("I wanted to pay with PayPal", exit.Note);
        Assert.Equal(Now, exit.AnsweredAtUtc);
    }

    [Fact]
    public void A_blank_note_is_no_note_and_a_long_one_is_refused()
    {
        var blank = CheckoutExit.Record(Guid.NewGuid(), Guid.NewGuid(), 5, Now);
        blank.Answer(CheckoutExitReason.SomethingElse, "   ", Now);
        Assert.Null(blank.Note);

        var exactly = CheckoutExit.Record(Guid.NewGuid(), Guid.NewGuid(), 5, Now);
        exactly.Answer(CheckoutExitReason.SomethingElse, " " + new string('a', CheckoutExit.NoteMaxLength) + " ", Now);
        Assert.Equal(CheckoutExit.NoteMaxLength, exactly.Note!.Length);

        var tooLong = CheckoutExit.Record(Guid.NewGuid(), Guid.NewGuid(), 5, Now);
        Assert.Throws<ArgumentOutOfRangeException>(
            () => tooLong.Answer(CheckoutExitReason.SomethingElse, new string('a', CheckoutExit.NoteMaxLength + 1), Now));
        Assert.Throws<ArgumentOutOfRangeException>(() => CheckoutExit.Record(Guid.NewGuid(), Guid.NewGuid(), -1, Now));
    }

    // ---------------------------------------------------------------- POST /api/billing/checkouts/{id}/exit

    [Fact]
    public async Task The_first_unpaid_return_is_recorded_and_asked_about()
    {
        using var h = new TestHarness(Now);
        var (user, tx) = Seed(h);

        var result = await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 37));

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Ask);
        // Read from the checkout, for "the page turns your $9.99 into naira", and the reuse window for "Try again".
        Assert.Equal(("USD", 999L, 30), (result.Value.Currency, result.Value.AmountMinor, result.Value.KeptMinutes));

        var exit = Assert.Single(h.Db.CheckoutExits);
        Assert.Equal((tx.Id, user.Id, 37, Now), (exit.PaymentTransactionId, exit.UserId, exit.SecondsOpen, exit.ReturnedAtUtc));
        Assert.Null(exit.Reason);
    }

    [Fact]
    public async Task A_checkout_is_asked_about_once_and_answered_once()
    {
        // "Try again" hands back the same checkout, so the same reference can come back unpaid twice: the second
        // return is not asked again, and a second answer (another device, a replayed request) changes nothing.
        using var h = new TestHarness(Now);
        var (user, tx) = Seed(h);

        await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 37));
        var answered = await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 37, CheckoutExitReason.CardDeclined));
        h.Clock.UtcNow = Now.AddMinutes(5);
        var again = await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 90));
        var secondAnswer = await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 90, CheckoutExitReason.JustLooking));

        Assert.False(answered.Value.Ask);
        Assert.False(again.Value.Ask);
        Assert.False(secondAnswer.Value.Ask);

        var exit = Assert.Single(h.Db.CheckoutExits);
        Assert.Equal((37, Now), (exit.SecondsOpen, exit.ReturnedAtUtc)); // the first return stands
        Assert.Equal((CheckoutExitReason.CardDeclined, Now), (exit.Reason, exit.AnsweredAtUtc));
    }

    [Fact]
    public async Task An_answer_sent_without_an_earlier_return_records_both()
    {
        // The client could not report the return (offline a moment), then the tap went through.
        using var h = new TestHarness(Now);
        var (user, tx) = Seed(h);

        var result = await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 12, CheckoutExitReason.SomethingElse, " Wanted PayPal "));

        Assert.False(result.Value.Ask);
        var exit = Assert.Single(h.Db.CheckoutExits);
        Assert.Equal((12, CheckoutExitReason.SomethingElse, "Wanted PayPal"), (exit.SecondsOpen, exit.Reason, exit.Note));
    }

    [Theory]
    [InlineData(PaymentStatus.Verified)]
    [InlineData(PaymentStatus.Completed)]
    public async Task A_paid_checkout_records_nothing_and_asks_nothing(PaymentStatus paid)
    {
        using var h = new TestHarness(Now);
        var (user, tx) = Seed(h);
        tx.MarkVerified("chk_seed", "{}", Now);
        if (paid == PaymentStatus.Completed)
            tx.MarkCompleted(Now);
        h.Db.SaveChanges();

        var result = await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 30, CheckoutExitReason.CardDeclined));

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Ask);
        Assert.Empty(h.Db.CheckoutExits);
    }

    [Fact]
    public async Task Someone_paying_by_transfer_is_recorded_but_not_asked()
    {
        // They left the page to send the money from their bank's app: nothing stopped them.
        using var h = new TestHarness(Now);
        var (user, tx) = Seed(h);

        var result = await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 300), Open(CheckoutAttempt.TransferStarted));

        Assert.False(result.Value.Ask);
        Assert.Single(h.Db.CheckoutExits);
        Assert.Equal(CheckoutAttempt.TransferStarted, tx.ProviderAttempt);
    }

    [Fact]
    public async Task A_declined_card_is_asked_about_and_recorded_from_the_page_read_just_now()
    {
        using var h = new TestHarness(Now);
        var (user, tx) = Seed(h);

        var result = await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 48), Open(CheckoutAttempt.Declined));

        Assert.True(result.Value.Ask);
        h.Db.ChangeTracker.Clear();
        var stored = h.Db.PaymentTransactions.Single();
        Assert.Equal((PaymentStatus.Processing, CheckoutAttempt.Declined), (stored.Status, stored.ProviderAttempt));
    }

    [Fact]
    public async Task No_answer_from_the_provider_records_the_return_and_asks_nothing()
    {
        // "No payment was made" is the provider's word, never a guess: an unreachable provider may be sitting on a
        // payment that landed a moment ago.
        using var h = new TestHarness(Now);
        var (user, tx) = Seed(h);
        var unreachable = new ScriptedGateway(PaymentProvider.Bachs) { Answer = Error.Network("Bachs.Verify", "Bachs returned 502.") };

        var result = await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 20), unreachable);

        Assert.False(result.Value.Ask);
        Assert.Single(h.Db.CheckoutExits);
        Assert.Equal(PaymentStatus.Processing, tx.Status);
    }

    [Fact]
    public async Task A_payment_the_provider_reports_as_the_page_closed_is_fulfilled_and_not_asked_about()
    {
        // Paid, then the page swiped away before it could send them back: the exit's own look at the provider finds
        // the money, fulfils it as confirm would, and records no unpaid return.
        using var h = new TestHarness(Now);
        var (user, tx) = Seed(h);
        var paid = new ScriptedGateway(PaymentProvider.Bachs)
        {
            Answer = new GatewayVerification(true, 999, "USD", "chk_seed", null, "{}", Terminal: true),
            Attempt = CheckoutAttempt.None,
        };

        var result = await Exit(h, user, new RecordCheckoutExitCommand(tx.Reference, 75), paid);

        Assert.False(result.Value.Ask);
        Assert.Empty(h.Db.CheckoutExits);
        Assert.Equal(PaymentStatus.Completed, tx.Status);
        Assert.Equal(user.Id, Assert.Single(h.Db.Subscriptions).UserId);
    }

    [Fact]
    public async Task Another_accounts_checkout_reads_as_not_found()
    {
        using var h = new TestHarness(Now);
        var (_, theirs) = Seed(h);
        var bystander = User.Create("Sam Bystander", "sam@example.com", "x", Now.AddDays(-1));
        h.Db.Users.Add(bystander);
        h.Db.SaveChanges();

        var result = await Exit(h, bystander, new RecordCheckoutExitCommand(theirs.Reference, 30, CheckoutExitReason.TooExpensive));
        var unknown = await Exit(h, bystander, new RecordCheckoutExitCommand("NF_nope", 30));

        Assert.Equal((ErrorType.NotFound, "BILLING_CHECKOUT_NOT_FOUND"), (result.Error.Type, result.Error.Code));
        Assert.Equal(ErrorType.NotFound, unknown.Error.Type);
        Assert.Empty(h.Db.CheckoutExits);
    }

    [Fact]
    public async Task An_unauthenticated_caller_is_refused()
    {
        using var h = new TestHarness(Now);
        var (_, tx) = Seed(h);

        var result = await new RecordCheckoutExitCommandHandler(
                h.Db, new StubCurrentUser(), Open(), h.Clock, h.Email, new BillingSettings())
            .Handle(new RecordCheckoutExitCommand(tx.Reference, 30), CancellationToken.None);

        Assert.Equal(ErrorType.Unauthorized, result.Error.Type);
    }

    [Theory]
    [InlineData(-1, null, null)]
    [InlineData(CheckoutExit.MaxSecondsOpen + 1, null, null)]
    [InlineData(10, 99, null)]
    [InlineData(10, 5, 281)]
    public void The_validator_refuses_what_a_client_could_not_have_meant(int seconds, int? reason, int? noteLength)
    {
        var command = new RecordCheckoutExitCommand(
            "NF_x", seconds, (CheckoutExitReason?)reason, noteLength is { } n ? new string('a', n) : null);

        Assert.False(new RecordCheckoutExitCommandValidator().Validate(command).IsValid);
    }

    [Fact]
    public void The_validator_takes_a_note_of_280_once_trimmed()
    {
        var command = new RecordCheckoutExitCommand("NF_x", 10, CheckoutExitReason.SomethingElse, "  " + new string('a', 280) + "  ");

        Assert.True(new RecordCheckoutExitCommandValidator().Validate(command).IsValid);
    }

    // ---------------------------------------------------------------- which client opened it

    [Theory]
    [InlineData("web", CheckoutClient.Web)]
    [InlineData(null, CheckoutClient.Phone)]
    [InlineData("app", CheckoutClient.Phone)]
    public async Task A_checkout_records_the_client_that_opened_it(string? client, CheckoutClient expected)
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Pat Payer", "pat@example.com", "x", Now.AddDays(-2));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly);
        h.Db.Users.Add(user);
        h.Db.Plans.Add(plan);
        h.Db.SaveChanges();

        var gateway = new ScriptedGateway(PaymentProvider.Bachs);
        var result = await new InitiateCheckoutCommandHandler(
                h.Db, new StubCurrentUser(user.Id), gateway, h.Clock, new BillingSettings(), h.Email)
            .Handle(new InitiateCheckoutCommand(plan.Id, client), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(expected, Assert.Single(h.Db.PaymentTransactions).Client);
    }

    // ---------------------------------------------------------------- read when the API verifies the session

    [Fact]
    public async Task Reconciling_an_open_session_records_the_declined_card_and_leaves_the_checkout_payable()
    {
        using var h = new TestHarness(Now);
        var (_, tx) = Seed(h);
        var gateway = new ScriptedGateway(PaymentProvider.Bachs)
        {
            Answer = Error.Network("Bachs.Verify", "not in a terminal state (status: open)"),
            Attempt = CheckoutAttempt.Declined,
        };

        var result = await new ReconcilePaymentCommandHandler(h.Db, gateway, h.Clock, h.Email)
            .Handle(new ReconcilePaymentCommand(tx.Id), CancellationToken.None);

        // The same transient answer as before: nothing closed, nothing fulfilled, the row still Processing.
        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
        h.Db.ChangeTracker.Clear();
        var stored = h.Db.PaymentTransactions.Single();
        Assert.Equal((PaymentStatus.Processing, CheckoutAttempt.Declined), (stored.Status, stored.ProviderAttempt));
        Assert.Empty(h.Db.Subscriptions);
    }

    [Fact]
    public async Task A_paid_session_is_fulfilled_exactly_as_before_whatever_the_page_showed()
    {
        using var h = new TestHarness(Now);
        var (user, tx) = Seed(h);
        var gateway = new ScriptedGateway(PaymentProvider.Bachs)
        {
            Answer = new GatewayVerification(true, 999, "USD", "chk_seed", null, "{}", Terminal: true),
            Attempt = CheckoutAttempt.Declined, // a card declined first, then a second card went through
        };

        var result = await new ReconcilePaymentCommandHandler(h.Db, gateway, h.Clock, h.Email)
            .Handle(new ReconcilePaymentCommand(tx.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(PaymentStatus.Completed, tx.Status);
        Assert.Equal(CheckoutAttempt.Declined, tx.ProviderAttempt);
        Assert.Equal(user.Id, Assert.Single(h.Db.Subscriptions).UserId);
    }

    [Fact]
    public async Task The_stale_sweep_records_the_signal_as_it_closes_the_checkout()
    {
        using var h = new TestHarness(Now.AddDays(2));
        var (_, tx) = Seed(h);
        var gateway = new ScriptedGateway(PaymentProvider.Bachs)
        {
            Answer = new GatewayVerification(false, 0, "USD", "chk_seed", null, "{}", Terminal: true),
            Attempt = CheckoutAttempt.Declined,
        };

        await new ClearStalePaymentsCommandHandler(
                h.Db, gateway, h.Clock, new BillingSettings(), h.Email, NullLogger<ClearStalePaymentsCommandHandler>.Instance)
            .Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        h.Db.ChangeTracker.Clear();
        var stored = h.Db.PaymentTransactions.Single();
        Assert.Equal((PaymentStatus.Failed, CheckoutAttempt.Declined), (stored.Status, stored.ProviderAttempt));
    }

    [Theory]
    [InlineData("open", "failed", "failed", CheckoutAttempt.Declined)]
    [InlineData("open", "unpaid", "processing", CheckoutAttempt.TransferStarted)]
    [InlineData("open", "unpaid", null, CheckoutAttempt.None)]
    [InlineData("open", "unpaid", "succeeded", CheckoutAttempt.TransferStarted)] // settling: money on its way
    [InlineData("expired", "failed", "failed", CheckoutAttempt.Declined)]
    [InlineData("completed", "succeeded", "succeeded", CheckoutAttempt.None)]
    public async Task Bachs_reads_the_attempt_from_the_session_it_verifies(
        string status, string paymentStatus, string? chargeStatus, CheckoutAttempt expected)
    {
        var body = JsonSerializer.Serialize(new
        {
            checkout_id = "chk_9f2b",
            status,
            payment_status = paymentStatus,
            amount = "9.99",
            currency = "USD",
            reference = "NF_7d4c",
            charge = chargeStatus is null ? null : new { amount = "14250.00", currency = "NGN", status = chargeStatus },
        });
        var gateway = new BachsPaymentGateway(
            new HttpClient(StubHttpMessageHandler.Returning(HttpStatusCode.OK, body)) { BaseAddress = new Uri("https://sandbox-api.bachs.io") },
            new BachsOptions { BaseUrl = "https://sandbox-api.bachs.io", SecretKey = "sk", WebhookSecret = "wh" },
            NullLogger<BachsPaymentGateway>.Instance);
        var request = new GatewayVerificationRequest("NF_7d4c", "chk_9f2b");

        var check = await gateway.CheckAsync(request, CancellationToken.None);
        var verify = await new BachsPaymentGateway(
                new HttpClient(StubHttpMessageHandler.Returning(HttpStatusCode.OK, body)) { BaseAddress = new Uri("https://sandbox-api.bachs.io") },
                new BachsOptions { BaseUrl = "https://sandbox-api.bachs.io", SecretKey = "sk", WebhookSecret = "wh" },
                NullLogger<BachsPaymentGateway>.Instance)
            .VerifyAsync(request, CancellationToken.None);

        Assert.Equal(expected, check.Attempt);
        // The verification is the one VerifyAsync gives: the attempt is only ever beside it.
        Assert.Equal(verify.IsSuccess, check.Verification.IsSuccess);
        if (verify.IsSuccess)
            Assert.Equal((verify.Value.Succeeded, verify.Value.Terminal), (check.Verification.Value.Succeeded, check.Verification.Value.Terminal));
        else
            Assert.Equal(verify.Error.Type, check.Verification.Error.Type);
    }

    [Fact]
    public async Task Bachs_reads_nothing_when_the_session_could_not_be_read()
    {
        var gateway = new BachsPaymentGateway(
            new HttpClient(StubHttpMessageHandler.Returning(HttpStatusCode.BadGateway, "{}")) { BaseAddress = new Uri("https://sandbox-api.bachs.io") },
            new BachsOptions { BaseUrl = "https://sandbox-api.bachs.io", SecretKey = "sk", WebhookSecret = "wh" },
            NullLogger<BachsPaymentGateway>.Instance);

        var check = await gateway.CheckAsync(new GatewayVerificationRequest("NF_7d4c", "chk_9f2b"), CancellationToken.None);

        Assert.True(check.Verification.IsFailure);
        Assert.Null(check.Attempt);
    }

    [Theory]
    [InlineData("failed", "card", 1, CheckoutAttempt.Declined)]
    [InlineData("abandoned", "card", 1, CheckoutAttempt.Declined)]
    [InlineData("ongoing", "bank_transfer", 0, CheckoutAttempt.TransferStarted)]
    [InlineData("pending", "bank", 0, CheckoutAttempt.TransferStarted)]
    [InlineData("abandoned", null, 0, CheckoutAttempt.None)]
    [InlineData("success", "card", 0, CheckoutAttempt.None)]
    public async Task Paystack_reads_the_attempt_from_the_transaction_it_verifies(
        string status, string? channel, int errors, CheckoutAttempt expected)
    {
        var body = JsonSerializer.Serialize(new
        {
            status = true,
            data = new
            {
                id = 4099260516L,
                status,
                reference = "NF_7d4c",
                amount = 750000,
                currency = "NGN",
                channel,
                log = new { attempts = Math.Max(1, errors), errors, success = status == "success" },
            },
        });
        var gateway = new PaystackPaymentGateway(
            new HttpClient(StubHttpMessageHandler.Returning(HttpStatusCode.OK, body)) { BaseAddress = new Uri("https://api.paystack.co") },
            new PaymentProviderOptions { SecretKey = "sk_test", BaseUrl = "https://api.paystack.co", SupportedCurrencies = "NGN" },
            NullLogger<PaystackPaymentGateway>.Instance);

        var check = await gateway.CheckAsync(new GatewayVerificationRequest("NF_7d4c", null), CancellationToken.None);

        Assert.True(check.Verification.IsSuccess);
        Assert.Equal(expected, check.Attempt);
    }

    // ---------------------------------------------------------------- the Growth card

    [Fact]
    public async Task The_growth_card_counts_by_provider_from_opened_to_answered()
    {
        using var h = new TestHarness(Now);
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        var people = Enumerable.Range(0, 9)
            .Select(i => User.Create($"Person {i}", $"person{i}@example.com", "x", Now.AddDays(-20)))
            .ToList();
        var staff = User.Create("Team", "team@example.com", "x", Now.AddDays(-20));
        staff.SetInternal(true);
        h.Db.Users.AddRange([.. people, staff]);
        h.Db.SaveChanges();

        var at = Now.AddDays(-3);
        // Bachs: declined and answered; closed in 8 s; looked for a minute and answered "something else"; paid;
        // a transfer under way. Paystack: answered "too much" after 40 s; never came back.
        Checkout(h, people[0], plan, PaymentProvider.Bachs, at, attempt: CheckoutAttempt.Declined,
            exit: (25, CheckoutExitReason.CardDeclined, null));
        Checkout(h, people[1], plan, PaymentProvider.Bachs, at, attempt: CheckoutAttempt.None, exit: (8, null, null));
        Checkout(h, people[2], plan, PaymentProvider.Bachs, at,
            exit: (61, CheckoutExitReason.SomethingElse, "I wanted to pay with PayPal"));
        Checkout(h, people[3], plan, PaymentProvider.Bachs, at, paid: true);
        Checkout(h, people[4], plan, PaymentProvider.Bachs, at, attempt: CheckoutAttempt.TransferStarted, exit: (300, null, null));
        Checkout(h, people[5], plan, PaymentProvider.Paystack, at, attempt: CheckoutAttempt.None,
            exit: (40, CheckoutExitReason.TooExpensive, null));
        Checkout(h, people[6], plan, PaymentProvider.Paystack, at);
        // Out of the count: before the window, a checkout whose page never opened, and the team's own test.
        Checkout(h, people[7], plan, PaymentProvider.Bachs, Now.AddDays(-60), exit: (10, CheckoutExitReason.Slow, null));
        Checkout(h, people[8], plan, PaymentProvider.Bachs, at, opened: false);
        Checkout(h, staff, plan, PaymentProvider.Bachs, at, exit: (10, CheckoutExitReason.SomethingElse, "test note"));

        var g = await new GetGrowthQueryHandler(h.Db, h.Clock, new AppReleaseSettings())
            .Handle(new GetGrowthQuery(), default);
        Assert.True(g.IsSuccess, g.IsFailure ? g.Error.Message : null);
        var card = g.Value.CheckoutExits;

        Assert.Equal(20, card.QuickSeconds);
        Assert.Equal(["all", "bachs", "paystack"], card.Providers.Select(p => p.Provider));

        var bachs = card.Providers.Single(p => p.Provider == "bachs");
        Assert.Equal((5, 4, 2, 1, 1), (bachs.Opened, bachs.CameBackUnpaid, bachs.Answered, bachs.Paid, bachs.Confirming));
        Assert.Equal((1, 1, 1, 1), (bachs.ClosedQuickly, bachs.Declined, bachs.LeftAfterLooking, bachs.TransferStarted));
        Assert.Equal(Enum.GetValues<CheckoutExitReason>(), bachs.Reasons.Select(r => r.Reason));
        Assert.Equal([0, 1, 0, 0, 0, 1], bachs.Reasons.Select(r => r.Count));

        var paystack = card.Providers.Single(p => p.Provider == "paystack");
        Assert.Equal((2, 1, 1, 0, 0), (paystack.Opened, paystack.CameBackUnpaid, paystack.Answered, paystack.Paid, paystack.Confirming));
        Assert.Equal(0, paystack.Reasons.Single(r => r.Reason == CheckoutExitReason.Currency).Count);
        Assert.Equal(1, paystack.LeftAfterLooking);

        var all = card.Providers.Single(p => p.Provider == "all");
        Assert.Equal((7, 5, 3), (all.Opened, all.CameBackUnpaid, all.Answered));

        // The notes: the words, the provider and when, never the account; the team's test note is not a customer's.
        var note = Assert.Single(card.Notes);
        Assert.Equal(("bachs", "I wanted to pay with PayPal"), (note.Provider, note.Note));
        Assert.Equal(DateTimeKind.Utc, note.AnsweredAtUtc.Kind);
        var wire = JsonSerializer.Serialize(card);
        Assert.DoesNotContain("@example.com", wire);
        Assert.DoesNotContain("Person", wire);
    }

    [Fact]
    public async Task An_empty_window_has_three_empty_slices_and_no_notes()
    {
        using var h = new TestHarness(Now);

        var g = await new GetGrowthQueryHandler(h.Db, h.Clock, new AppReleaseSettings())
            .Handle(new GetGrowthQuery(), default);

        Assert.All(g.Value.CheckoutExits.Providers, p => Assert.Equal((0, 0, 0), (p.Opened, p.CameBackUnpaid, p.Answered)));
        Assert.Empty(g.Value.CheckoutExits.Notes);
    }

    // ---------------------------------------------------------------- the Unpaid checkouts list

    [Fact]
    public async Task The_unpaid_list_names_each_person_with_what_the_page_saw_their_answer_and_a_later_payment()
    {
        using var h = new TestHarness(Now);
        var plan = Plan.Create(Guid.NewGuid(), "one_song_usd", "One song", 199, "USD", BillingInterval.Single);
        h.Db.Plans.Add(plan);
        var ada = User.Create("Ada Obi", "ada@example.com", "x", Now.AddDays(-20));
        var ben = User.Create("Ben Ade", "ben@example.com", "x", Now.AddDays(-20));
        var cy = User.Create("Cy Eze", "cy@example.com", "x", Now.AddDays(-20));
        var staff = User.Create("Team", "team@example.com", "x", Now.AddDays(-20));
        staff.SetInternal(true);
        h.Db.Users.AddRange(ada, ben, cy, staff);
        h.Db.SaveChanges();

        // Ada: declined, answered with a note, then paid two hours later. Ben: closed the tab, never came back.
        // Cy: paid at once (not listed). The team's own test and a page never handed out are not listed either.
        Checkout(h, ada, plan, PaymentProvider.Bachs, Now.AddDays(-3), attempt: CheckoutAttempt.Declined,
            exit: (42, CheckoutExitReason.SomethingElse, "My bank blocks dollar payments"));
        Checkout(h, ada, plan, PaymentProvider.Bachs, Now.AddDays(-3).AddHours(2), paid: true);
        Checkout(h, ben, plan, PaymentProvider.Bachs, Now.AddDays(-1));
        Checkout(h, cy, plan, PaymentProvider.Bachs, Now.AddDays(-2), paid: true);
        Checkout(h, staff, plan, PaymentProvider.Bachs, Now.AddDays(-1), exit: (5, CheckoutExitReason.Slow, null));
        Checkout(h, cy, plan, PaymentProvider.Bachs, Now.AddDays(-1), opened: false);

        var result = await new GetUnpaidCheckoutsQueryHandler(h.Db, h.Clock).Handle(new GetUnpaidCheckoutsQuery(), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        var list = result.Value;

        Assert.Equal(2, list.Total);
        Assert.Equal(["ben@example.com", "ada@example.com"], list.Rows.Select(r => r.Email));

        var benRow = list.Rows[0];
        Assert.Equal(("Ben Ade", false, (CheckoutExitReason?)null, (DateTime?)null),
            (benRow.Name, benRow.CameBack, benRow.Reason, benRow.PaidLaterAtUtc));

        var adaRow = list.Rows[1];
        Assert.Equal(("bachs", "One song", 199L, "USD"), (adaRow.Provider, adaRow.PlanName, adaRow.AmountMinor, adaRow.Currency));
        Assert.Equal((CheckoutAttempt.Declined, true, 42), (adaRow.Attempt!.Value, adaRow.CameBack, adaRow.SecondsOpen!.Value));
        Assert.Equal((CheckoutExitReason.SomethingElse, "My bank blocks dollar payments"), (adaRow.Reason!.Value, adaRow.Note));
        Assert.Equal(Now.AddDays(-3).AddHours(2), adaRow.PaidLaterAtUtc);
        Assert.Equal(DateTimeKind.Utc, adaRow.OpenedAtUtc.Kind);
    }

    // ---------------------------------------------------------------- fixtures

    private static Task<Result<CheckoutExitDto>> Exit(
        TestHarness h, User caller, RecordCheckoutExitCommand command, ScriptedGateway? provider = null)
        => new RecordCheckoutExitCommandHandler(
                h.Db, new StubCurrentUser(caller.Id), provider ?? Open(), h.Clock, h.Email, new BillingSettings())
            .Handle(command, CancellationToken.None);

    /// <summary>Bachs reading an open session (still payable, not final) whose page shows <paramref name="seen"/>.</summary>
    private static ScriptedGateway Open(CheckoutAttempt seen = CheckoutAttempt.None) => new(PaymentProvider.Bachs)
    {
        Answer = Error.Network("Bachs.Verify", "Bachs checkout chk_seed is not in a terminal state (status: open)."),
        Attempt = seen,
    };

    /// <summary>A customer with an open dollar checkout, as a browser closed by hand leaves it.</summary>
    private static (User User, PaymentTransaction Transaction) Seed(TestHarness h)
    {
        var user = User.Create("Pat Payer", "pat@example.com", "x", Now.AddDays(-2));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly);
        var tx = PaymentTransaction.Create(user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_seed", "NF_seed", 999, "USD", Now.AddMinutes(-2));
        tx.AttachCheckout("chk_seed", "https://pay.test/seed", "{}", Now.AddMinutes(-2));
        h.Db.Users.Add(user);
        h.Db.Plans.Add(plan);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
        return (user, tx);
    }

    private static void Checkout(
        TestHarness h, User user, Plan plan, PaymentProvider provider, DateTime at,
        bool opened = true, bool paid = false, CheckoutAttempt? attempt = null,
        (int Seconds, CheckoutExitReason? Reason, string? Note)? exit = null)
    {
        var reference = $"NF_{Guid.NewGuid():N}";
        var tx = PaymentTransaction.Create(user.Id, plan.Id, provider, $"checkout:{reference}", reference, plan.AmountMinor, plan.Currency, at);
        if (opened)
            tx.AttachCheckout($"chk_{reference}", "https://pay.test/s", "{}", at);
        if (attempt is { } seen)
            tx.RecordProviderAttempt(seen);
        if (paid)
        {
            tx.MarkVerified($"chk_{reference}", "{}", at);
            tx.MarkCompleted(at);
        }
        h.Db.PaymentTransactions.Add(tx);
        if (exit is { } e)
        {
            var row = CheckoutExit.Record(tx.Id, user.Id, e.Seconds, at.AddMinutes(1));
            if (e.Reason is { } reason)
                row.Answer(reason, e.Note, at.AddMinutes(1));
            h.Db.CheckoutExits.Add(row);
        }
        h.Db.SaveChanges();
    }

    /// <summary>
    /// One provider's gateway (and factory) with a scripted verification and page signal, through the interface's
    /// <c>CheckAsync</c>; it opens sessions for the initiate tests.
    /// </summary>
    private sealed class ScriptedGateway(PaymentProvider provider) : IPaymentGatewayFactory, IPaymentGateway
    {
        public Result<GatewayVerification> Answer { get; init; } =
            Error.Network("Stub.Verify", "still open");

        public CheckoutAttempt? Attempt { get; init; }

        public PaymentProvider Provider => provider;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD", "NGN"];

        public IPaymentGateway Resolve(PaymentProvider p) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(new GatewayInitiation($"https://pay.test/{request.Reference}", $"chk_{request.Reference}", "{}")));

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => Task.FromResult(Answer);

        public Task<GatewayCheck> CheckAsync(GatewayVerificationRequest request, CancellationToken ct)
            => Task.FromResult(new GatewayCheck(Answer, Attempt));
    }
}
