using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEmailVerification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "EmailVerificationAttempts",
                table: "users",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "EmailVerificationCodeHash",
                table: "users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "EmailVerificationExpiry",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "EmailVerificationSentAtUtc",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "EmailVerified",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Every account that existed before this migration predates verification, and login now refuses
            // an unverified one. Without this line the deploy locks out the entire user base — including the
            // admins who would have to fix it — so it is not an optimisation, it is the migration.
            //
            // Trusting these addresses is the only sane reading: they have been receiving receipts and reset
            // links all along, and grandfathering them costs nothing that a fresh code could recover.
            migrationBuilder.Sql("""UPDATE users SET "EmailVerified" = TRUE;""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EmailVerificationAttempts",
                table: "users");

            migrationBuilder.DropColumn(
                name: "EmailVerificationCodeHash",
                table: "users");

            migrationBuilder.DropColumn(
                name: "EmailVerificationExpiry",
                table: "users");

            migrationBuilder.DropColumn(
                name: "EmailVerificationSentAtUtc",
                table: "users");

            migrationBuilder.DropColumn(
                name: "EmailVerified",
                table: "users");
        }
    }
}
