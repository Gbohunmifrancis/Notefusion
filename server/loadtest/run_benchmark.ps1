# run_benchmark.ps1
# Runs the Locust load-test benchmark across multiple concurrency levels.

param (
    [string]$HostUrl = "http://127.0.0.1:8000",
    [string]$AudioFile = "c:\Users\ADMIN\OneDrive\Desktop\PROJECTS\Note\server\tests\accuracy\real\harness_stand_in_1.wav",
    [string]$OutDir = "c:\Users\ADMIN\OneDrive\Desktop\PROJECTS\Note\server\loadtest\results"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$env:LOCUST_AUDIO_FILE = $AudioFile

Write-Host "Running 1 user (Warmup/Baseline)..."
locust -f server/loadtest/locustfile.py --host $HostUrl --users 1 --spawn-rate 1 --run-time 2m --headless --csv "$OutDir/pro-warm-u1" --html "$OutDir/pro-warm-u1.html"

foreach ($users in @(2, 4, 8, 16)) {
    Write-Host "Running $users users..."
    locust -f server/loadtest/locustfile.py --host $HostUrl --users $users --spawn-rate 2 --run-time 3m --headless --csv "$OutDir/pro-warm-u$users" --html "$OutDir/pro-warm-u$users.html"
}

Write-Host "Benchmark complete. Summarising..."
python server/loadtest/summarise_results.py $OutDir
