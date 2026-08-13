using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Queries;

/// <summary>
/// The total revenue balance, derived by summing the immutable ledger — never read from a stored
/// column, so it cannot drift from the entries that justify it. Admin-only (wired at the controller).
/// The product is single-currency (USD), so entries are summed into one balance.
/// </summary>
public sealed record GetLedgerBalanceQuery : IRequest<Result<LedgerBalanceDto>>;

public sealed class GetLedgerBalanceQueryHandler : IRequestHandler<GetLedgerBalanceQuery, Result<LedgerBalanceDto>>
{
    private readonly IApplicationDbContext _db;

    public GetLedgerBalanceQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<LedgerBalanceDto>> Handle(GetLedgerBalanceQuery request, CancellationToken ct)
    {
        // Sum the signed amount in the database. Credits add, debits subtract — the balance is a
        // pure function of the append-only entries.
        var balance = await _db.LedgerEntries
            .SumAsync(e => e.Direction == Core.Enums.LedgerDirection.Credit ? e.AmountMinor : -e.AmountMinor, ct);

        var currency = await _db.LedgerEntries
            .OrderBy(e => e.CreatedAtUtc)
            .Select(e => e.Currency)
            .FirstOrDefaultAsync(ct) ?? "USD";

        return new LedgerBalanceDto(balance, currency);
    }
}
