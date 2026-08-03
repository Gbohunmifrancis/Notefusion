<#
.SYNOPSIS
    Deploy NoteFusion backend services to Heroku via Git Procfile.
#>

$ApiKey = "REDACTED-USE-ENV-HEROKU_API_KEY"
$TranscriberApp = "notefusion-transcriber"
$ApiApp = "notefusion-api"

$env:HEROKU_API_KEY = $ApiKey
[System.Environment]::SetEnvironmentVariable("HEROKU_API_KEY", $ApiKey, "Process")

Write-Host "=== Deploying NoteFusion to Heroku via Procfile / Buildpacks ===" -ForegroundColor Cyan

# 1. Identity
$who = heroku whoami
Write-Host "Authenticated as: $who" -ForegroundColor Green

# 2. Deploy Python Transcriber
Write-Host "Deploying Python Transcriber ($TranscriberApp)..." -ForegroundColor Yellow
heroku stack:set heroku-24 -a $TranscriberApp

$transcriberGitUrl = "https://_:${ApiKey}@git.heroku.com/${TranscriberApp}.git"
git subtree push --prefix server $transcriberGitUrl main

# 3. Deploy C# Web API
Write-Host "Deploying C# Web API ($ApiApp)..." -ForegroundColor Yellow
heroku stack:set heroku-24 -a $ApiApp

$apiGitUrl = "https://_:${ApiKey}@git.heroku.com/${ApiApp}.git"
git push $apiGitUrl HEAD:refs/heads/main --force

Write-Host "=== Heroku Buildpack Deployment Triggered! ===" -ForegroundColor Green
