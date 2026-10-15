using Microsoft.EntityFrameworkCore;
using NoteFusion.Core.Entities;
using NoteFusion.Core.ValueObjects;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Auth;

/// <summary>
/// The canonical inbox: which addresses deliver to one mailbox, and so share one free allowance. A rule that
/// merges too little leaves the alias trick open; one that merges too much takes the free tries of a
/// stranger who happens to look alike, which is the worse mistake — so the "kept apart" cases matter as
/// much as the "merged" ones.
/// </summary>
public class MailboxTests
{
    [Theory]
    // Plain addresses are only lowercased and trimmed.
    [InlineData("ada@example.com", "ada@example.com")]
    [InlineData("  Ada@Example.COM  ", "ada@example.com")]
    // A +tag is dropped on every domain.
    [InlineData("ada+notefusion@example.com", "ada@example.com")]
    [InlineData("ada+1@outlook.com", "ada@outlook.com")]
    [InlineData("ADA+Tag@Example.com", "ada@example.com")]
    [InlineData("ada+a+b@example.com", "ada@example.com")] // everything from the first '+'
    [InlineData("ada+@example.com", "ada@example.com")] // an empty tag
    // Gmail: dots dropped too, and googlemail.com is gmail.com.
    [InlineData("a.d.a@gmail.com", "ada@gmail.com")]
    [InlineData("A.Da+x@Gmail.com", "ada@gmail.com")]
    [InlineData("ada@googlemail.com", "ada@gmail.com")]
    [InlineData("a.da+2@googlemail.com", "ada@gmail.com")]
    [InlineData("ada.@gmail.com", "ada@gmail.com")]
    public void Aliases_resolve_to_one_inbox(string email, string expected)
        => Assert.Equal(expected, Mailbox.Canonical(email));

    [Theory]
    // Dots are kept off Gmail, where a.b@ and ab@ can be two people.
    [InlineData("a.da@example.com", "a.da@example.com")]
    [InlineData("a.da@outlook.com", "a.da@outlook.com")]
    [InlineData("a.da@gmail.com.ng", "a.da@gmail.com.ng")] // not Gmail: a lookalike domain
    [InlineData("a.da@mail.gmail.com", "a.da@mail.gmail.com")]
    // Nothing before the '+' to keep: left as typed rather than collapsing into "@domain".
    [InlineData("+tag@example.com", "+tag@example.com")]
    [InlineData("+tag@gmail.com", "+tag@gmail.com")]
    // A Gmail local part that is nothing but dots keeps them rather than becoming empty.
    [InlineData("...@gmail.com", "...@gmail.com")]
    public void Look_alike_addresses_stay_apart(string email, string expected)
        => Assert.Equal(expected, Mailbox.Canonical(email));

    [Theory]
    [InlineData("not-an-email", "not-an-email")]
    [InlineData(" No-At+Sign ", "no-at+sign")]
    [InlineData("@example.com", "@example.com")]
    [InlineData("ada@", "ada@")]
    [InlineData("", "")]
    public void Input_that_is_not_an_address_comes_back_lowercased_and_otherwise_alone(string email, string expected)
        => Assert.Equal(expected, Mailbox.Canonical(email));

    [Fact]
    public void The_domain_is_after_the_last_at()
        => Assert.Equal("\"a@b\"@gmail.com", Mailbox.Canonical("\"a@b\"@GMAIL.com"));

    [Fact]
    public void Two_people_on_gmail_with_different_names_stay_apart()
        => Assert.NotEqual(Mailbox.Canonical("ada@gmail.com"), Mailbox.Canonical("adam@gmail.com"));

    [Fact]
    public void Every_way_of_making_an_account_records_the_inbox()
    {
        var now = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);

        Assert.Equal("ada@gmail.com", User.Create("Ada", "A.da+1@Gmail.com", "hash", now).CanonicalEmail);
        Assert.Equal("ada@gmail.com", User.CreateFromGoogle("Ada", "a.da@googlemail.com", "sub", null, now).CanonicalEmail);
        Assert.Equal("ops@example.com", User.CreateAdmin("Ops", "ops+admin@example.com", "hash", now).CanonicalEmail);
    }

    [Fact]
    public async Task The_startup_backfill_fills_rows_made_before_the_column_and_leaves_the_rest()
    {
        using var h = new TestHarness();
        for (var i = 0; i < CanonicalEmailBackfill.BatchSize + 3; i++) // more than one batch
            h.Db.Users.Add(User.Create("Old", $"old.{i}+x@gmail.com", "hash", h.Clock.UtcNow));
        h.Db.Users.Add(User.Create("New", "new@example.com", "hash", h.Clock.UtcNow));
        await h.Db.SaveChangesAsync();
        // As the migration leaves an existing row: the column added, nothing in it.
        await h.Db.Users.Where(u => u.Email != "new@example.com")
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.CanonicalEmail, (string?)null));
        h.Db.ChangeTracker.Clear();

        var filled = await CanonicalEmailBackfill.RunAsync(h.Db);

        Assert.Equal(CanonicalEmailBackfill.BatchSize + 3, filled);
        var rows = await h.Db.Users.AsNoTracking().ToListAsync();
        Assert.All(rows, u => Assert.Equal(Mailbox.Canonical(u.Email), u.CanonicalEmail));
        Assert.Equal(0, await CanonicalEmailBackfill.RunAsync(h.Db)); // a no-op once done
    }
}
