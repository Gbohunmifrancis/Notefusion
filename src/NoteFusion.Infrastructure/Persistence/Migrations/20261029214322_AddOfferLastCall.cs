using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOfferLastCall : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_offer_emails_OfferId_UserId",
                table: "offer_emails");

            migrationBuilder.AddColumn<string>(
                name: "LastCallBody",
                table: "offers",
                type: "character varying(1200)",
                maxLength: 1200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastCallHeadline",
                table: "offers",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastCallPreheader",
                table: "offers",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastCallStartedAtUtc",
                table: "offers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LastCallStartedBy",
                table: "offers",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastCallSubject",
                table: "offers",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Round",
                table: "offer_emails",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Launch"); // every email sent so far was a launch email

            migrationBuilder.CreateIndex(
                name: "IX_offer_emails_OfferId_UserId_Round",
                table: "offer_emails",
                columns: new[] { "OfferId", "UserId", "Round" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // One email per person per offer again: the last calls go first.
            migrationBuilder.Sql("DELETE FROM offer_emails WHERE \"Round\" = 'LastCall';");

            migrationBuilder.DropIndex(
                name: "IX_offer_emails_OfferId_UserId_Round",
                table: "offer_emails");

            migrationBuilder.DropColumn(
                name: "LastCallBody",
                table: "offers");

            migrationBuilder.DropColumn(
                name: "LastCallHeadline",
                table: "offers");

            migrationBuilder.DropColumn(
                name: "LastCallPreheader",
                table: "offers");

            migrationBuilder.DropColumn(
                name: "LastCallStartedAtUtc",
                table: "offers");

            migrationBuilder.DropColumn(
                name: "LastCallStartedBy",
                table: "offers");

            migrationBuilder.DropColumn(
                name: "LastCallSubject",
                table: "offers");

            migrationBuilder.DropColumn(
                name: "Round",
                table: "offer_emails");

            migrationBuilder.CreateIndex(
                name: "IX_offer_emails_OfferId_UserId",
                table: "offer_emails",
                columns: new[] { "OfferId", "UserId" },
                unique: true);
        }
    }
}
