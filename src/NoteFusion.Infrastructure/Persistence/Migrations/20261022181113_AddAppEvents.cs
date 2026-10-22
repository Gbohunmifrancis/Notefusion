using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAppEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "app_events",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Detail = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    DeviceHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    AppBuild = table.Column<int>(type: "integer", nullable: false),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReceivedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_events", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_app_events_Name_OccurredAtUtc",
                table: "app_events",
                columns: new[] { "Name", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_app_events_OccurredAtUtc",
                table: "app_events",
                column: "OccurredAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_app_events_UserId_OccurredAtUtc",
                table: "app_events",
                columns: new[] { "UserId", "OccurredAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "app_events");
        }
    }
}
