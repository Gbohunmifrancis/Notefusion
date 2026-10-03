using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RepairDeadProfilePictures : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Production ran on LoggingImageStorage while the R2 settings never reached the container,
            // and that sink "saved" every upload as a placeholder on the reserved .invalid domain, which
            // can never resolve. Those photos render blank. Clearing them shows initials again, and a
            // Google account gets its Google photo back on the next sign-in (SetProfilePictureIfMissing).
            migrationBuilder.Sql("""UPDATE users SET "ProfilePictureUrl" = NULL WHERE "ProfilePictureUrl" LIKE 'https://images.invalid/%';""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Nothing to restore: the cleared values were URLs that never pointed at anything.
        }
    }
}
