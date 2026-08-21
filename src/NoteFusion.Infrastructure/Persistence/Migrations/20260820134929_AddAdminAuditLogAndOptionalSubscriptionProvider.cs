using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminAuditLogAndOptionalSubscriptionProvider : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Provider",
                table: "subscriptions",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20);

            migrationBuilder.CreateTable(
                name: "admin_audit_logs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorEmail = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    Action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    TargetUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    TargetEmail = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    IpAddress = table.Column<string>(type: "character varying(45)", maxLength: 45, nullable: true),
                    Summary = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_admin_audit_logs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_admin_audit_logs_Action",
                table: "admin_audit_logs",
                column: "Action");

            migrationBuilder.CreateIndex(
                name: "IX_admin_audit_logs_OccurredAtUtc",
                table: "admin_audit_logs",
                column: "OccurredAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_admin_audit_logs_TargetUserId_OccurredAtUtc",
                table: "admin_audit_logs",
                columns: new[] { "TargetUserId", "OccurredAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "admin_audit_logs");

            migrationBuilder.AlterColumn<string>(
                name: "Provider",
                table: "subscriptions",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20,
                oldNullable: true);
        }
    }
}
