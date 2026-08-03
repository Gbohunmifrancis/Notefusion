<#
.SYNOPSIS
    Automated Heroku Deployment script for NoteFusion backend services using Docker Registry.
#>

param (
    [string]$ApiKey = "REDACTED-USE-ENV-HEROKU_API_KEY",
    [string]$TranscriberAppName = "notefusion-transcriber",
    [string]$ApiAppName = "notefusion-api"
)

$ErrorActionPreference = "Stop"

if (-not [string]::IsNullOrWhiteSpace($ApiKey)) {
    $env:HEROKU_API_KEY = $ApiKey
    [System.Environment]::SetEnvironmentVariable("HEROKU_API_KEY", $ApiKey, "Process")
}

Write-Host "=== Deploying NoteFusion to Heroku via Docker Registry ===" -ForegroundColor Cyan

# 1. Identity & Container Registry Login
Write-Host "[1/5] Verifying Heroku identity..." -ForegroundColor Yellow
$who = heroku whoami
Write-Host "Authenticated as: $who" -ForegroundColor Green

Write-Host "[2/5] Logging into registry.heroku.com..." -ForegroundColor Yellow
docker login --username=_ --password=$env:HEROKU_API_KEY registry.heroku.com

# 2. Python Transcriber Service
Write-Host "[3/5] Deploying Python Transcriber ($TranscriberAppName)..." -ForegroundColor Yellow
try { heroku apps:create $TranscriberAppName } catch { Write-Host "App '$TranscriberAppName' registered." -ForegroundColor Gray }
heroku stack:set container -a $TranscriberAppName

Write-Host "Building Python Transcriber container image..." -ForegroundColor Yellow
docker build -t registry.heroku.com/${TranscriberAppName}/web ./server

Write-Host "Pushing Python Transcriber to Heroku Registry..." -ForegroundColor Yellow
docker push registry.heroku.com/${TranscriberAppName}/web

Write-Host "Releasing Python Transcriber on Heroku..." -ForegroundColor Yellow
heroku container:release web -a $TranscriberAppName

# 3. C# Web API Gateway
Write-Host "[4/5] Deploying C# API Gateway ($ApiAppName)..." -ForegroundColor Yellow
try { heroku apps:create $ApiAppName } catch { Write-Host "App '$ApiAppName' registered." -ForegroundColor Gray }
heroku stack:set container -a $ApiAppName

$existingAddons = heroku addons -a $ApiAppName
if ($existingAddons -notmatch "heroku-postgresql") {
    heroku addons:create heroku-postgresql:essential-0 -a $ApiAppName
} else {
    Write-Host "Heroku Postgres database already attached." -ForegroundColor Gray
}

heroku config:set TranscriptionApi__BaseUrl="https://${TranscriberAppName}.herokuapp.com" Database__ApplyMigrationsAtStartup=true -a $ApiAppName

Write-Host "Building C# Web API container image..." -ForegroundColor Yellow
docker build -f src/NoteFusion.Api/Dockerfile -t registry.heroku.com/${ApiAppName}/web .

Write-Host "Pushing C# Web API to Heroku Registry..." -ForegroundColor Yellow
docker push registry.heroku.com/${ApiAppName}/web

Write-Host "Releasing C# Web API on Heroku..." -ForegroundColor Yellow
heroku container:release web -a $ApiAppName

# 4. Final summary
Write-Host "=== Heroku Deployment Completed Successfully! ===" -ForegroundColor Green
Write-Host "C# API Gateway: https://${ApiAppName}.herokuapp.com" -ForegroundColor Cyan
Write-Host "Swagger OpenAPI Docs: https://${ApiAppName}.herokuapp.com/swagger" -ForegroundColor Cyan
Write-Host "Python ML Transcriber: https://${TranscriberAppName}.herokuapp.com" -ForegroundColor Cyan
