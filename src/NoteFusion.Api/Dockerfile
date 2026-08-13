# NoteFusion C# Web API — multi-stage build.
# Build context is the REPO ROOT (project references span src/), so build with:
#   docker build -f src/NoteFusion.Api/Dockerfile -t notefusion-api .
# docker-compose sets this context/dockerfile pair for you.

# ── Admin dashboard ───────────────────────────────────────────────────────────
# The API is also the dashboard's web server (it serves the bundle from wwwroot), so the
# Vite build happens here instead of in a separate deploy. VITE_API_URL is deliberately
# left unset: the bundle is served from the API's own origin, so relative paths are right.
FROM node:22-alpine AS dashboard
WORKDIR /dashboard

COPY web-admin/package.json web-admin/package-lock.json ./
RUN npm ci

COPY web-admin/ ./
RUN npm run build

# ── C# API ────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first so the NuGet layer caches when only source changes. Copy just the
# project files (and the shared props/solution) that restore needs.
COPY Directory.Build.props NoteFusion.slnx ./
COPY src/NoteFusion.Shared/NoteFusion.Shared.csproj          src/NoteFusion.Shared/
COPY src/NoteFusion.Core/NoteFusion.Core.csproj              src/NoteFusion.Core/
COPY src/NoteFusion.Application/NoteFusion.Application.csproj src/NoteFusion.Application/
COPY src/NoteFusion.Infrastructure/NoteFusion.Infrastructure.csproj src/NoteFusion.Infrastructure/
COPY src/NoteFusion.Api/NoteFusion.Api.csproj                src/NoteFusion.Api/
RUN dotnet restore src/NoteFusion.Api/NoteFusion.Api.csproj

# Copy the rest of the source and publish a framework-dependent build.
COPY src/ src/
RUN dotnet publish src/NoteFusion.Api/NoteFusion.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS runtime
WORKDIR /app

COPY --from=build /app/publish ./

# The dashboard lands in wwwroot, where the static-file middleware picks it up. Program.cs
# only enables that middleware when index.html is present, so an API-only build still runs.
COPY --from=dashboard /dashboard/dist ./wwwroot

# Kestrel binds Heroku's dynamic $PORT, falling back to 8080 for compose.
CMD sh -c "ASPNETCORE_URLS=http://+:${PORT:-8080} dotnet NoteFusion.Api.dll"
