using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Http;

namespace NoteFusion.Infrastructure.Push;

/// <summary>
/// Reads Expo's receipts (https://docs.expo.dev/push-notifications/sending-notifications/#push-receipts): what Google
/// or Apple did with each push Expo took. Never throws for Expo's failures: an unread receipt is read next time.
/// </summary>
public sealed class ExpoPushReceipts : IPushReceipts
{
    private const string ExpoReceiptsUrl = "https://exp.host/--/api/v2/push/getReceipts";

    /// <summary>Expo answers for up to 1,000 tickets per request.</summary>
    internal const int MaxPerRequest = 1000;

    private readonly HttpClient _http;
    private readonly PushTicketLog _tickets;
    private readonly ExpoPushSettings _settings;
    private readonly ILogger<ExpoPushReceipts> _logger;

    public ExpoPushReceipts(
        HttpClient http, PushTicketLog tickets, ILogger<ExpoPushReceipts> logger, ExpoPushSettings? settings = null)
    {
        _http = http;
        _tickets = tickets;
        _logger = logger;
        _settings = settings ?? new ExpoPushSettings();
    }

    /// <summary>How long the test alert waits between asks; a test sets it short.</summary>
    internal TimeSpan PollEvery { get; init; } = TimeSpan.FromSeconds(1.5);

    /// <summary>
    /// The receipts Expo has for these tickets (a ticket Google has not answered yet is missing), or null when Expo
    /// could not be asked.
    /// </summary>
    public async Task<IReadOnlyDictionary<string, PushReceipt>?> ReadAsync(
        IReadOnlyList<string> ticketIds, CancellationToken ct = default)
    {
        if (ticketIds.Count == 0)
            return new Dictionary<string, PushReceipt>();

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, ExpoReceiptsUrl)
            {
                Content = JsonContent.Create(
                    new ExpoReceiptsRequest([.. ticketIds.Take(MaxPerRequest)]),
                    ExpoPushJsonContext.Default.ExpoReceiptsRequest),
            };
            _settings.Authorize(request);
            using var response = await _http.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Expo push receipts returned {StatusCode}.", (int)response.StatusCode);
                return null;
            }

            var result = await response.Content.ReadFromJsonAsync(ExpoPushJsonContext.Default.ExpoReceiptsResponse, ct);
            return (result?.Data ?? [])
                // A refusal that names no code is still a refusal: its status stands in for the code.
                .ToDictionary(r => r.Key, r => new PushReceipt(
                    r.Value.Status == "ok" ? null : r.Value.ErrorCode ?? r.Value.Status ?? "error", r.Value.Message));
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException
                                   || (ex is TaskCanceledException && !ct.IsCancellationRequested)
                                   || OutboundFailure.IsUnanswered(ex, ct))
        {
            _logger.LogWarning(ex, "Could not read the Expo push receipts.");
            return null;
        }
    }

    public async Task<PushReceipt?> WaitAsync(string ticketId, TimeSpan within, CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + within;
        while (true)
        {
            // Google usually answers within a second or two of Expo taking it.
            await Task.Delay(PollEvery, ct);
            var receipts = await ReadAsync([ticketId], ct);
            if (receipts is not null && receipts.TryGetValue(ticketId, out var receipt))
            {
                _tickets.Settle(ticketId, receipt);
                return receipt;
            }
            if (DateTime.UtcNow + PollEvery > deadline)
                return null;
        }
    }

    public PushReceiptStats Stats(DateTime utcNow) => _tickets.Stats();
}
