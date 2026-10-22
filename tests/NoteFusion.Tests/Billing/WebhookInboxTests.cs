using System.Text;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Api.Common;
using NoteFusion.Api.Controllers;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The front of the webhook pipeline: what the provider is answered, and what the inbox keeps. A provider
/// retries on a 5xx and gives up on a 4xx, so the status code decides whether a delivery we failed to keep is
/// ever seen again; and an event that cannot settle a payment is kept as handled, not retried into a parked failure.
/// </summary>
public class WebhookInboxTests
{
    private static readonly DateTime Now = new(2026, 10, 22, 12, 0, 0, DateTimeKind.Utc);
    private const string Body = """{"id":"evt_1","type":"collection.succeeded","data":{"reference":"NF_abc"}}""";

    [Fact]
    public async Task A_delivery_the_inbox_could_not_keep_is_answered_503_so_the_provider_retries_it()
    {
        var sender = new StubSender(Result.Failure<Guid>(Error.Failure("BILLING_WEBHOOK_PERSIST_FAILED", "Could not persist the webhook event.")));
        var controller = Controller(sender, new AcceptingValidator());

        var response = await controller.Receive("bachs", CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(response);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, status.StatusCode);
        Assert.Equal("BILLING_WEBHOOK_PERSIST_FAILED", Assert.IsType<ApiError>(status.Value).Code);
    }

    [Fact]
    public async Task A_kept_delivery_is_answered_200_and_the_validator_sees_the_wire_bytes()
    {
        var sender = new StubSender(Result.Success(Guid.NewGuid()));
        var validator = new AcceptingValidator();
        var controller = Controller(sender, validator);

        var response = await controller.Receive("bachs", CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, Assert.IsType<OkObjectResult>(response).StatusCode);
        Assert.Equal(Encoding.UTF8.GetBytes(Body), validator.Seen!.RawBytes);
        Assert.Equal(Body, validator.Seen.RawBody);
        var ingest = Assert.IsType<IngestWebhookCommand>(sender.Sent);
        Assert.Equal(Body, ingest.Payload);
        Assert.False(ingest.Settles); // the validator's verdict travels into the inbox
    }

    [Fact]
    public async Task A_delivery_the_signature_refuses_is_answered_401_and_never_stored()
    {
        var sender = new StubSender(Result.Success(Guid.NewGuid()));
        var controller = Controller(sender, new RefusingValidator());

        var response = await controller.Receive("bachs", CancellationToken.None);

        Assert.Equal(StatusCodes.Status401Unauthorized, Assert.IsType<ObjectResult>(response).StatusCode);
        Assert.Null(sender.Sent);
    }

    [Fact]
    public async Task An_event_that_cannot_settle_a_payment_is_kept_as_handled_and_never_reaches_the_worker()
    {
        using var h = new TestHarness(Now);
        var handler = new IngestWebhookCommandHandler(h.Db, h.Clock);

        var payout = await handler.Handle(
            new IngestWebhookCommand(PaymentProvider.Bachs, "evt_payout", "payout.paid", null, "{}", Settles: false),
            CancellationToken.None);
        var paid = await handler.Handle(
            new IngestWebhookCommand(PaymentProvider.Bachs, "evt_paid", "collection.succeeded", "NF_abc", Body),
            CancellationToken.None);

        Assert.True(payout.IsSuccess);
        Assert.True(paid.IsSuccess);
        var rows = await h.Db.WebhookEvents.ToDictionaryAsync(e => e.ProviderEventId, e => e);
        Assert.Equal(WebhookStatus.Processed, rows["evt_payout"].Status);
        Assert.Equal(Now, rows["evt_payout"].ProcessedAtUtc);
        Assert.Equal(WebhookStatus.Received, rows["evt_paid"].Status);
        Assert.Null(rows["evt_paid"].ProcessedAtUtc);
    }

    private static PaymentWebhooksController Controller(ISender sender, IPaymentWebhookValidator validator)
    {
        var http = new DefaultHttpContext();
        http.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(Body));
        http.Request.Headers["X-Bachs-Signature"] = "sig";
        return new PaymentWebhooksController(sender, [validator])
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };
    }

    private sealed class AcceptingValidator : IPaymentWebhookValidator
    {
        public WebhookRequest? Seen { get; private set; }
        public PaymentProvider Provider => PaymentProvider.Bachs;

        public Result<WebhookMessage> Validate(WebhookRequest request)
        {
            Seen = request;
            return new WebhookMessage("evt_1", "payout.paid", null, Settles: false);
        }
    }

    private sealed class RefusingValidator : IPaymentWebhookValidator
    {
        public PaymentProvider Provider => PaymentProvider.Bachs;
        public Result<WebhookMessage> Validate(WebhookRequest request)
            => Error.Unauthorized("Bachs.Webhook", "Signature verification failed.");
    }

    private sealed class StubSender(Result<Guid> answer) : ISender
    {
        public object? Sent { get; private set; }

        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
        {
            Sent = request;
            return Task.FromResult((TResponse)(object)answer);
        }

        public Task<object?> Send(object request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default) where TRequest : IRequest => throw new NotSupportedException();
        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
