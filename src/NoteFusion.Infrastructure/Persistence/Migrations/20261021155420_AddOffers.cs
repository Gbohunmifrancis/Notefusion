using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOffers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "OfferId",
                table: "payment_transactions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "offers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Template = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    PercentOff = table.Column<int>(type: "integer", nullable: false),
                    IncludesMonthly = table.Column<bool>(type: "boolean", nullable: false),
                    IncludesYearly = table.Column<bool>(type: "boolean", nullable: false),
                    StartsAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastDay = table.Column<DateOnly>(type: "date", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    Subject = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Preheader = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Headline = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Body = table.Column<string>(type: "character varying(1200)", maxLength: 1200, nullable: false),
                    SendStartedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SendStartedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    SendPaused = table.Column<bool>(type: "boolean", nullable: false),
                    SendIncludesFree = table.Column<bool>(type: "boolean", nullable: false),
                    SendIncludesLapsed = table.Column<bool>(type: "boolean", nullable: false),
                    SendIncludesProNow = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedByEmail = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_offers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "offer_emails",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OfferId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Group = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SkipReason = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    Token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    QueuedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SentAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClickedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_offer_emails", x => x.Id);
                    table.ForeignKey(
                        name: "FK_offer_emails_offers_OfferId",
                        column: x => x.OfferId,
                        principalTable: "offers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_offer_emails_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_payment_transactions_OfferId",
                table: "payment_transactions",
                column: "OfferId",
                filter: "\"OfferId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_offer_emails_OfferId_Status",
                table: "offer_emails",
                columns: new[] { "OfferId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_offer_emails_OfferId_UserId",
                table: "offer_emails",
                columns: new[] { "OfferId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_offer_emails_Token",
                table: "offer_emails",
                column: "Token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_offer_emails_UserId",
                table: "offer_emails",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_offers_Key",
                table: "offers",
                column: "Key",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "offer_emails");

            migrationBuilder.DropTable(
                name: "offers");

            migrationBuilder.DropIndex(
                name: "IX_payment_transactions_OfferId",
                table: "payment_transactions");

            migrationBuilder.DropColumn(
                name: "OfferId",
                table: "payment_transactions");
        }
    }
}
