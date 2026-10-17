using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPracticeReminders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PracticeReminderHour",
                table: "users",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PracticeReminderSound",
                table: "users",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PracticeRemindersOn",
                table: "users",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PracticeRemindersSinceUtc",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TimeZone",
                table: "users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ServerReminders",
                table: "device_tokens",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "practice_reminders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LocalDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Slot = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Streak = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Body = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Sound = table.Column<bool>(type: "boolean", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Devices = table.Column<int>(type: "integer", nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    Error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SentAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_practice_reminders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_practice_reminders_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_practice_reminders_CreatedAtUtc",
                table: "practice_reminders",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_practice_reminders_LocalDate",
                table: "practice_reminders",
                column: "LocalDate");

            migrationBuilder.CreateIndex(
                name: "IX_practice_reminders_UserId_LocalDate_Slot",
                table: "practice_reminders",
                columns: new[] { "UserId", "LocalDate", "Slot" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "practice_reminders");

            migrationBuilder.DropColumn(
                name: "PracticeReminderHour",
                table: "users");

            migrationBuilder.DropColumn(
                name: "PracticeReminderSound",
                table: "users");

            migrationBuilder.DropColumn(
                name: "PracticeRemindersOn",
                table: "users");

            migrationBuilder.DropColumn(
                name: "PracticeRemindersSinceUtc",
                table: "users");

            migrationBuilder.DropColumn(
                name: "TimeZone",
                table: "users");

            migrationBuilder.DropColumn(
                name: "ServerReminders",
                table: "device_tokens");
        }
    }
}
