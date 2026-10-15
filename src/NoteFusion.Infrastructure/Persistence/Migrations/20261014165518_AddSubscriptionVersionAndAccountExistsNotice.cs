using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSubscriptionVersionAndAccountExistsNotice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "AccountExistsNoticeSentAtUtc",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "subscriptions",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AccountExistsNoticeSentAtUtc",
                table: "users");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "subscriptions");
        }
    }
}
