using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddGooglePlayPurchases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "google_play_purchases",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    PurchaseToken = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    ProductId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    BasePlanId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IsSubscription = table.Column<bool>(type: "boolean", nullable: false),
                    State = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    AutoRenewing = table.Column<bool>(type: "boolean", nullable: false),
                    ExpiryUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LatestOrderId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Acknowledged = table.Column<bool>(type: "boolean", nullable: false),
                    Consumed = table.Column<bool>(type: "boolean", nullable: false),
                    ReplacedByToken = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_google_play_purchases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_google_play_purchases_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_google_play_purchases_PurchaseToken",
                table: "google_play_purchases",
                column: "PurchaseToken",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_google_play_purchases_UpdatedAtUtc",
                table: "google_play_purchases",
                column: "UpdatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_google_play_purchases_UserId_ProductId",
                table: "google_play_purchases",
                columns: new[] { "UserId", "ProductId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "google_play_purchases");
        }
    }
}
