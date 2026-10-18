using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCheckoutExits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Every checkout before this one was opened by the phone app unless its idempotency key carries the
            // website's ":web" suffix (InitiateCheckoutCommand); an empty name would not read back as a CheckoutClient.
            migrationBuilder.AddColumn<string>(
                name: "Client",
                table: "payment_transactions",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "Phone");

            migrationBuilder.Sql(
                "UPDATE payment_transactions SET \"Client\" = 'Web' WHERE \"IdempotencyKey\" LIKE '%:web';");

            migrationBuilder.AddColumn<string>(
                name: "ProviderAttempt",
                table: "payment_transactions",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "checkout_exits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentTransactionId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReturnedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SecondsOpen = table.Column<int>(type: "integer", nullable: false),
                    Reason = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Note = table.Column<string>(type: "character varying(280)", maxLength: 280, nullable: true),
                    AnsweredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_checkout_exits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_checkout_exits_payment_transactions_PaymentTransactionId",
                        column: x => x.PaymentTransactionId,
                        principalTable: "payment_transactions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_checkout_exits_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_checkout_exits_AnsweredAtUtc",
                table: "checkout_exits",
                column: "AnsweredAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_checkout_exits_PaymentTransactionId",
                table: "checkout_exits",
                column: "PaymentTransactionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_checkout_exits_UserId",
                table: "checkout_exits",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "checkout_exits");

            migrationBuilder.DropColumn(
                name: "Client",
                table: "payment_transactions");

            migrationBuilder.DropColumn(
                name: "ProviderAttempt",
                table: "payment_transactions");
        }
    }
}
