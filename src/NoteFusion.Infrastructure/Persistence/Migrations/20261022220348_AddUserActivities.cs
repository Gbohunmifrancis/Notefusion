using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserActivities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ClientId",
                table: "web_events",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ClientId",
                table: "app_events",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "user_activities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Detail = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    Client = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_activities", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_web_events_VisitorId_ClientId",
                table: "web_events",
                columns: new[] { "VisitorId", "ClientId" });

            migrationBuilder.CreateIndex(
                name: "IX_app_events_UserId_ClientId",
                table: "app_events",
                columns: new[] { "UserId", "ClientId" });

            migrationBuilder.CreateIndex(
                name: "IX_user_activities_Name_OccurredAtUtc",
                table: "user_activities",
                columns: new[] { "Name", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_user_activities_OccurredAtUtc",
                table: "user_activities",
                column: "OccurredAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_user_activities_UserId_OccurredAtUtc",
                table: "user_activities",
                columns: new[] { "UserId", "OccurredAtUtc" });

            // Sign-ins before this log existed: every refresh token that did not replace another was handed out by a
            // sign-in (a refresh rotates, and points its spent token at the new one), so they become the history the
            // console had no way to show. How they signed in was never stored; where from was.
            if (migrationBuilder.ActiveProvider == "Npgsql.EntityFrameworkCore.PostgreSQL")
            {
                migrationBuilder.Sql("""
                    INSERT INTO user_activities ("Id", "UserId", "Name", "Detail", "Client", "OccurredAtUtc")
                    SELECT gen_random_uuid(), t."UserId", 'sign_in', NULL,
                           CASE t."Client" WHEN 'app' THEN 'phone' WHEN 'web' THEN 'web' ELSE NULL END,
                           t."IssuedAt"
                    FROM refresh_tokens t
                    WHERE NOT EXISTS (SELECT 1 FROM refresh_tokens p WHERE p."ReplacedByTokenId" = t."Id");
                    """);
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_activities");

            migrationBuilder.DropIndex(
                name: "IX_web_events_VisitorId_ClientId",
                table: "web_events");

            migrationBuilder.DropIndex(
                name: "IX_app_events_UserId_ClientId",
                table: "app_events");

            migrationBuilder.DropColumn(
                name: "ClientId",
                table: "web_events");

            migrationBuilder.DropColumn(
                name: "ClientId",
                table: "app_events");
        }
    }
}
