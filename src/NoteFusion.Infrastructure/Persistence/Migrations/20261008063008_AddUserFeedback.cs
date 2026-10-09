using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserFeedback : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "user_feedback",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Rating = table.Column<int>(type: "integer", nullable: true),
                    Category = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Message = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Client = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    AppVersion = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Screen = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_feedback", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_user_feedback_Kind_CreatedAtUtc",
                table: "user_feedback",
                columns: new[] { "Kind", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_user_feedback_UserId_Kind_CreatedAtUtc",
                table: "user_feedback",
                columns: new[] { "UserId", "Kind", "CreatedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_feedback");
        }
    }
}
