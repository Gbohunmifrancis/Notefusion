using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminPhoneLock : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Client",
                table: "refresh_tokens",
                type: "character varying(8)",
                maxLength: 8,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "admin_phone_keys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SecretHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Label = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_admin_phone_keys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_admin_phone_keys_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_admin_phone_keys_UserId",
                table: "admin_phone_keys",
                column: "UserId");

            // Admins sign in once more, phone and console: their refresh tokens from before carry no client, and a
            // phone's token refreshed as if from a browser would skip the phone's lock. Everyone else is untouched.
            migrationBuilder.Sql("""
                UPDATE refresh_tokens SET "IsRevoked" = TRUE, "RevokedAt" = now()
                WHERE NOT "IsRevoked" AND "UserId" IN (SELECT "Id" FROM users WHERE "Role" = 'Admin');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "admin_phone_keys");

            migrationBuilder.DropColumn(
                name: "Client",
                table: "refresh_tokens");
        }
    }
}
