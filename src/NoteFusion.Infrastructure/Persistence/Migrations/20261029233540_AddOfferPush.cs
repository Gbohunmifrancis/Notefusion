using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOfferPush : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_offer_emails_OfferId_UserId_Round",
                table: "offer_emails");

            migrationBuilder.AddColumn<string>(
                name: "Channel",
                table: "offer_emails",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Email"); // every message so far was an email

            migrationBuilder.CreateIndex(
                name: "IX_offer_emails_OfferId_UserId_Round_Channel",
                table: "offer_emails",
                columns: new[] { "OfferId", "UserId", "Round", "Channel" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Emails only again: the notifications go first.
            migrationBuilder.Sql("DELETE FROM offer_emails WHERE \"Channel\" <> 'Email';");

            migrationBuilder.DropIndex(
                name: "IX_offer_emails_OfferId_UserId_Round_Channel",
                table: "offer_emails");

            migrationBuilder.DropColumn(
                name: "Channel",
                table: "offer_emails");

            migrationBuilder.CreateIndex(
                name: "IX_offer_emails_OfferId_UserId_Round",
                table: "offer_emails",
                columns: new[] { "OfferId", "UserId", "Round" },
                unique: true);
        }
    }
}
