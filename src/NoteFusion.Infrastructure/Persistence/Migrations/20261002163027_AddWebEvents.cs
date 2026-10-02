using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWebEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "web_events",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    Path = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Target = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Referrer = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    VisitorId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SessionId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Device = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_web_events", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_web_events_Kind_OccurredAtUtc",
                table: "web_events",
                columns: new[] { "Kind", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_web_events_OccurredAtUtc",
                table: "web_events",
                column: "OccurredAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_web_events_UserId_OccurredAtUtc",
                table: "web_events",
                columns: new[] { "UserId", "OccurredAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "web_events");
        }
    }
}
