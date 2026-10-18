using System.Collections.Concurrent;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Push;

/// <summary>
/// Expo's tickets until their receipts are read, the tokens Expo said are dead, and what the last day's answers were
/// (System Health). In memory, as the quota gate and the passkey challenges are: one API instance, and a restart only
/// loses the receipts of pushes sent in the few minutes before it.
/// </summary>
public sealed class PushTicketLog
{
    /// <summary>Expo keeps a receipt for a day; a ticket unanswered after that never will be.</summary>
    public static readonly TimeSpan Keep = TimeSpan.FromHours(24);

    /// <summary>At most this many tickets waiting, and answers remembered, so a flood cannot grow the API unbounded.</summary>
    public const int MaxPending = 20_000;
    public const int MaxAnswers = 50_000;

    private readonly IDateTimeProvider _clock;
    private readonly ConcurrentDictionary<string, Pending> _pending = new();
    private readonly ConcurrentQueue<string> _dead = new();
    private readonly object _gate = new();
    private readonly Queue<(DateTime At, string? Code)> _answers = new();

    private sealed record Pending(string Token, DateTime SentAtUtc);

    public PushTicketLog(IDateTimeProvider clock) => _clock = clock;

    public int Waiting => _pending.Count;

    /// <summary>A push Expo took for <paramref name="token"/>: its receipt is read later.</summary>
    public void Track(string ticketId, string token)
    {
        if (_pending.Count < MaxPending)
            _pending[ticketId] = new Pending(token, _clock.UtcNow);
    }

    /// <summary>Tickets sent at least <paramref name="minAge"/> ago, oldest first, whose receipts are still to read.</summary>
    public IReadOnlyList<string> Due(TimeSpan minAge, int max)
    {
        var before = _clock.UtcNow - minAge;
        return _pending
            .Where(p => p.Value.SentAtUtc <= before)
            .OrderBy(p => p.Value.SentAtUtc)
            .Take(max)
            .Select(p => p.Key)
            .ToList();
    }

    /// <summary>Records one ticket's receipt; false when it was not waiting (the test alert read it first).</summary>
    public bool Settle(string ticketId, PushReceipt receipt)
    {
        if (!_pending.TryRemove(ticketId, out var pending))
            return false;
        Record(receipt.ErrorCode, pending.Token);
        return true;
    }

    /// <summary>Drops tickets past <see cref="Keep"/>: Expo no longer holds their receipts. Returns how many.</summary>
    public int Expire()
    {
        var before = _clock.UtcNow - Keep;
        var stale = _pending.Where(p => p.Value.SentAtUtc < before).Select(p => p.Key).ToList();
        foreach (var id in stale)
            _pending.TryRemove(id, out _);
        return stale.Count;
    }

    /// <summary>
    /// One answer: null for a push Google or Apple took, else Expo's code. A refusal with no receipt to wait for (a
    /// ticket's own error, Expo refusing the request) is recorded here directly. A dead phone's token is kept for
    /// <see cref="TakeDead"/>.
    /// </summary>
    public void Record(string? code, string? token = null)
    {
        if (code == PushProblems.DeviceNotRegistered && token is not null)
            _dead.Enqueue(token);

        var now = _clock.UtcNow;
        lock (_gate)
        {
            _answers.Enqueue((now, code));
            Trim(now);
        }
    }

    /// <summary>The tokens Expo said are dead since the last call, once each.</summary>
    public IReadOnlyList<string> TakeDead()
    {
        var tokens = new HashSet<string>(StringComparer.Ordinal);
        while (_dead.TryDequeue(out var token))
            tokens.Add(token);
        return [.. tokens];
    }

    public PushReceiptStats Stats()
    {
        var now = _clock.UtcNow;
        lock (_gate)
        {
            Trim(now);
            int refused = 0;
            (DateTime At, string? Code)? last = null;
            foreach (var answer in _answers)
            {
                if (answer.Code is null)
                    continue;
                refused++;
                last = answer;
            }
            return new PushReceiptStats(_answers.Count, refused, last?.Code, last?.At);
        }
    }

    private void Trim(DateTime now)
    {
        var before = now - Keep;
        while (_answers.Count > 0 && (_answers.Count > MaxAnswers || _answers.Peek().At < before))
            _answers.Dequeue();
    }
}
