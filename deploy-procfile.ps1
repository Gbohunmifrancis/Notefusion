<#
.SYNOPSIS
    Deploy NoteFusion backend services to Heroku via Git Procfile.
#>

# Never hardcode credentials. Provide the key via the HEROKU_API_KEY environment
# variable before running. Get one with: heroku authorizations:create
$ApiKey = $env:HEROKU_API_KEY
$TranscriberApp = "notefusion-transcriber"
$ApiApp = "notefusion-api"

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    throw "HEROKU_API_KEY is not set. Set the env var before running. See heroku authorizations:create."
}

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
# Newer Heroku apps no longer route the bare <name>.herokuapp.com host — the real
# web URL carries a random suffix. Derive it so the API always points at a live host.
$TranscriberUrl = ((heroku apps:info -a $TranscriberApp --json | ConvertFrom-Json).app.web_url).TrimEnd('/')
Write-Host "Transcriber URL resolved to: $TranscriberUrl" -ForegroundColor Gray
heroku config:set TranscriptionApi__BaseUrl="$TranscriberUrl" -a $ApiApp

$apiGitUrl = "https://_:${ApiKey}@git.heroku.com/${ApiApp}.git"
git push $apiGitUrl HEAD:refs/heads/main --force

Write-Host "=== Heroku Buildpack Deployment Triggered! ===" -ForegroundColor Green
