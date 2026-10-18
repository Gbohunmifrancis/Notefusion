using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.GooglePlay;

/// <summary>
/// The Google Play Developer API (androidpublisher v3) for <see cref="GooglePlayOptions.PackageName"/>. A token Google
/// does not know (400, 404, 410) is <c>BILLING_PLAY_PURCHASE_NOT_FOUND</c>; anything else that is not an answer (a
/// timeout, an outage, a refused service account) is <c>BILLING_PLAY_UNAVAILABLE</c>, which every caller treats as
/// "ask again later", never as "not paid".
/// </summary>
internal sealed class GooglePlayClient : IGooglePlayClient
{
    private readonly HttpClient _http;
    private readonly GooglePlayAccessTokens _tokens;
    private readonly GooglePlayOptions _options;
    private readonly ILogger<GooglePlayClient> _logger;

    public GooglePlayClient(HttpClient http, GooglePlayAccessTokens tokens, GooglePlayOptions options, ILogger<GooglePlayClient> logger)
    {
        _http = http;
        _tokens = tokens;
        _options = options;
        _logger = logger;
    }

    public bool IsConfigured => _options.IsConfigured;
    public string PackageName => _options.PackageName;

    private string App => $"/androidpublisher/v3/applications/{Uri.EscapeDataString(_options.PackageName)}";

    public async Task<Result<PlaySubscription>> GetSubscriptionAsync(string purchaseToken, CancellationToken ct)
    {
        var read = await SendAsync(HttpMethod.Get, $"{App}/purchases/subscriptionsv2/tokens/{Uri.EscapeDataString(purchaseToken)}", ct);
        if (read.IsFailure)
            return read.Error;
        return ParseSubscription(read.Value);
    }

    public async Task<Result<PlayOneTimePurchase>> GetOneTimePurchaseAsync(string productId, string purchaseToken, CancellationToken ct)
    {
        var read = await SendAsync(HttpMethod.Get,
            $"{App}/purchases/products/{Uri.EscapeDataString(productId)}/tokens/{Uri.EscapeDataString(purchaseToken)}", ct);
        if (read.IsFailure)
            return read.Error;
        return ParseOneTime(read.Value);
    }

    public async Task<Result<PlayOrder>> GetOrderAsync(string orderId, CancellationToken ct)
    {
        var read = await SendAsync(HttpMethod.Get, $"{App}/orders/{Uri.EscapeDataString(orderId)}", ct);
        if (read.IsFailure)
            return read.Error;
        return ParseOrder(read.Value) is { } order ? order : BillingErrors.PlayUnavailable;
    }

    public async Task<Result> AcknowledgeSubscriptionAsync(string productId, string purchaseToken, CancellationToken ct)
    {
        var sent = await SendAsync(HttpMethod.Post,
            $"{App}/purchases/subscriptions/{Uri.EscapeDataString(productId)}/tokens/{Uri.EscapeDataString(purchaseToken)}:acknowledge",
            ct, body: "{}");
        return sent.IsSuccess ? Result.Success() : sent.Error;
    }

    public async Task<Result> ConsumeAsync(string productId, string purchaseToken, CancellationToken ct)
    {
        var sent = await SendAsync(HttpMethod.Post,
            $"{App}/purchases/products/{Uri.EscapeDataString(productId)}/tokens/{Uri.EscapeDataString(purchaseToken)}:consume", ct);
        return sent.IsSuccess ? Result.Success() : sent.Error;
    }

    private async Task<Result<string>> SendAsync(HttpMethod method, string path, CancellationToken ct, string? body = null)
    {
        if (!_options.IsConfigured)
            return BillingErrors.PlayNotConfigured;

        var token = await _tokens.GetAsync(ct);
        if (token.IsFailure)
            return token.Error;

        try
        {
            using var request = new HttpRequestMessage(method, path);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Value);
            if (body is not null)
                request.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");

            using var response = await _http.SendAsync(request, ct);
            var raw = await response.Content.ReadAsStringAsync(ct);
            if (response.IsSuccessStatusCode)
                return raw;

            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone or HttpStatusCode.BadRequest)
                return BillingErrors.PlayPurchaseNotFound;

            // A 401/403 is our configuration (a key Google refuses, a service account without Play Console access),
            // and is said loudly; the purchase itself is untouched and is asked about again.
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                _logger.LogError("Google Play refused the service account: {Status} {Message}", (int)response.StatusCode, Message(raw));
            else
                _logger.LogWarning("Google Play API {Method} answered {Status}: {Message}", method, (int)response.StatusCode, Message(raw));
            return BillingErrors.PlayUnavailable;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning("Could not reach Google Play: {Message}", ex.Message);
            return BillingErrors.PlayUnavailable;
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            return BillingErrors.PlayUnavailable;
        }
    }

    internal static Result<PlaySubscription> ParseSubscription(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            var state = Str(root, "subscriptionState");
            if (string.IsNullOrEmpty(state))
                return BillingErrors.PlayUnavailable;

            JsonElement? item = root.TryGetProperty("lineItems", out var items) && items.ValueKind == JsonValueKind.Array
                                && items.GetArrayLength() > 0
                ? items[0]
                : null;

            var expiry = item is { } i1 && Str(i1, "expiryTime") is { } e
                         && DateTime.TryParse(e, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var parsed)
                ? parsed
                : (DateTime?)null;
            var autoRenew = item is { } i2 && i2.TryGetProperty("autoRenewingPlan", out var plan)
                            && plan.TryGetProperty("autoRenewEnabled", out var on) && on.ValueKind == JsonValueKind.True;
            var basePlan = item is { } i3 && i3.TryGetProperty("offerDetails", out var offer) ? Str(offer, "basePlanId") : null;
            var accountId = root.TryGetProperty("externalAccountIdentifiers", out var ids) ? Str(ids, "obfuscatedExternalAccountId") : null;

            return new PlaySubscription(
                State: state,
                ProductId: item is { } i4 ? Str(i4, "productId") : null,
                BasePlanId: basePlan,
                ExpiryUtc: expiry,
                AutoRenewing: autoRenew,
                LatestSuccessfulOrderId: item is { } i5 ? Str(i5, "latestSuccessfulOrderId") : null,
                LinkedPurchaseToken: Str(root, "linkedPurchaseToken"),
                AccountId: accountId,
                Acknowledged: Str(root, "acknowledgementState") == "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
                RegionCode: Str(root, "regionCode"),
                Raw: raw);
        }
        catch (JsonException)
        {
            return BillingErrors.PlayUnavailable;
        }
    }

    internal static Result<PlayOneTimePurchase> ParseOneTime(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            // purchaseState 0 purchased, 1 cancelled, 2 pending; absent means purchased.
            var state = Int(root, "purchaseState") switch
            {
                1 => "CANCELED",
                2 => "PENDING",
                _ => "PURCHASED"
            };
            return new PlayOneTimePurchase(
                State: state,
                OrderId: Str(root, "orderId"),
                AccountId: Str(root, "obfuscatedExternalAccountId"),
                Acknowledged: Int(root, "acknowledgementState") == 1,
                Consumed: Int(root, "consumptionState") == 1,
                RegionCode: Str(root, "regionCode"),
                Raw: raw);
        }
        catch (JsonException)
        {
            return BillingErrors.PlayUnavailable;
        }
    }

    /// <summary>The order's total (what the customer paid, tax included) in minor units, and its state.</summary>
    internal static PlayOrder? ParseOrder(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (!root.TryGetProperty("total", out var total) || Str(total, "currencyCode") is not { } currency)
                return null;
            var units = Str(total, "units") is { } u && long.TryParse(u, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var whole)
                ? whole
                : total.TryGetProperty("units", out var un) && un.TryGetInt64(out var n) ? n : 0;
            var nanos = Int(total, "nanos") ?? 0;
            var major = units + nanos / 1_000_000_000m;
            return new PlayOrder(CurrencyUnits.RoundToMinor(major, currency), currency.ToUpperInvariant(), Str(root, "state") ?? string.Empty);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Str(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static int? Int(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : null;

    private static string? Message(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.Object ? Str(e, "message") : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
