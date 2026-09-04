using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeviceAppBuild : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AppBuild",
                table: "device_tokens",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "NotifiedBuild",
                table: "device_tokens",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_device_tokens_AppBuild_NotifiedBuild",
                table: "device_tokens",
                columns: new[] { "AppBuild", "NotifiedBuild" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_device_tokens_AppBuild_NotifiedBuild",
                table: "device_tokens");

            migrationBuilder.DropColumn(
                name: "AppBuild",
                table: "device_tokens");

            migrationBuilder.DropColumn(
                name: "NotifiedBuild",
                table: "device_tokens");
        }
    }
}
