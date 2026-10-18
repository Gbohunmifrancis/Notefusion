using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPaymentAlerts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Existing phones start as a new DeviceToken does: the chime, vibration and problem alerts on, payment
            // alerts off until an admin opens Admin on that phone. The defaults fill the rows only; the model has none.
            migrationBuilder.AddColumn<bool>(
                name: "PaymentAlertHideNames",
                table: "device_tokens",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "PaymentAlertQuietAtNight",
                table: "device_tokens",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "PaymentAlertSound",
                table: "device_tokens",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "chime");

            migrationBuilder.AddColumn<bool>(
                name: "PaymentAlertVibrate",
                table: "device_tokens",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "PaymentAlerts",
                table: "device_tokens",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "PaymentAlertsMutedUntilUtc",
                table: "device_tokens",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PaymentAlertsSetAtUtc",
                table: "device_tokens",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PaymentProblemAlerts",
                table: "device_tokens",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "admin_payment_alerts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentTransactionId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    LastAttemptAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SentAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Devices = table.Column<int>(type: "integer", nullable: false),
                    Accepted = table.Column<int>(type: "integer", nullable: false),
                    Refused = table.Column<int>(type: "integer", nullable: false),
                    Error = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_admin_payment_alerts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_admin_payment_alerts_payment_transactions_PaymentTransactio~",
                        column: x => x.PaymentTransactionId,
                        principalTable: "payment_transactions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_admin_payment_alerts_CreatedAtUtc",
                table: "admin_payment_alerts",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_admin_payment_alerts_PaymentTransactionId",
                table: "admin_payment_alerts",
                column: "PaymentTransactionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_admin_payment_alerts_SentAtUtc_CreatedAtUtc",
                table: "admin_payment_alerts",
                columns: new[] { "SentAtUtc", "CreatedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "admin_payment_alerts");

            migrationBuilder.DropColumn(
                name: "PaymentAlertHideNames",
                table: "device_tokens");

            migrationBuilder.DropColumn(
                name: "PaymentAlertQuietAtNight",
                table: "device_tokens");

            migrationBuilder.DropColumn(
                name: "PaymentAlertSound",
                table: "device_tokens");

            migrationBuilder.DropColumn(
                name: "PaymentAlertVibrate",
                table: "device_tokens");

            migrationBuilder.DropColumn(
                name: "PaymentAlerts",
                table: "device_tokens");

            migrationBuilder.DropColumn(
                name: "PaymentAlertsMutedUntilUtc",
                table: "device_tokens");

            migrationBuilder.DropColumn(
                name: "PaymentAlertsSetAtUtc",
                table: "device_tokens");

            migrationBuilder.DropColumn(
                name: "PaymentProblemAlerts",
                table: "device_tokens");
        }
    }
}
