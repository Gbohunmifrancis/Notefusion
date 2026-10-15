using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddChoirPlan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "choir_id",
                table: "transcriptions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ChoirId",
                table: "transcription_jobs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ChoirSeats",
                table: "plans",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "choirs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    InviteCode = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    PlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Seats = table.Column<int>(type: "integer", nullable: false),
                    CurrentPeriodStartUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CurrentPeriodEndUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_choirs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_choirs_users_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "choir_members",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ChoirId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    JoinedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_choir_members", x => x.Id);
                    table.ForeignKey(
                        name: "FK_choir_members_choirs_ChoirId",
                        column: x => x.ChoirId,
                        principalTable: "choirs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_choir_members_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_transcriptions_choir_id",
                table: "transcriptions",
                column: "choir_id");

            migrationBuilder.CreateIndex(
                name: "IX_transcription_jobs_ChoirId_SongCreditConsumedAtUtc",
                table: "transcription_jobs",
                columns: new[] { "ChoirId", "SongCreditConsumedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_choir_members_ChoirId",
                table: "choir_members",
                column: "ChoirId");

            migrationBuilder.CreateIndex(
                name: "IX_choir_members_UserId",
                table: "choir_members",
                column: "UserId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_choirs_InviteCode",
                table: "choirs",
                column: "InviteCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_choirs_OwnerId",
                table: "choirs",
                column: "OwnerId",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_transcriptions_choirs_choir_id",
                table: "transcriptions",
                column: "choir_id",
                principalTable: "choirs",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_transcriptions_choirs_choir_id",
                table: "transcriptions");

            migrationBuilder.DropTable(
                name: "choir_members");

            migrationBuilder.DropTable(
                name: "choirs");

            migrationBuilder.DropIndex(
                name: "IX_transcriptions_choir_id",
                table: "transcriptions");

            migrationBuilder.DropIndex(
                name: "IX_transcription_jobs_ChoirId_SongCreditConsumedAtUtc",
                table: "transcription_jobs");

            migrationBuilder.DropColumn(
                name: "choir_id",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "ChoirId",
                table: "transcription_jobs");

            migrationBuilder.DropColumn(
                name: "ChoirSeats",
                table: "plans");
        }
    }
}
