# run_ab_test.ps1
# Runs the accuracy evaluation twice (control and treatment) and compares them.

$ErrorActionPreference = "Stop"

Write-Host "Running control arm..."
docker compose run --rm -e NF_CONTOUR_GAP_MERGE="0" transcriber python -m tests.accuracy.report --real
if (Test-Path tests/accuracy/real_report.json) {
    Move-Item -Path tests/accuracy/real_report.json -Destination tests/accuracy/real_report.control.json -Force
}

Write-Host "Running contour-gap arm..."
docker compose run --rm -e NF_CONTOUR_GAP_MERGE="1" transcriber python -m tests.accuracy.report --real
if (Test-Path tests/accuracy/real_report.json) {
    Move-Item -Path tests/accuracy/real_report.json -Destination tests/accuracy/real_report.contour-gap.json -Force
}

Write-Host "Comparing arms..."
docker compose run --rm transcriber python tests/accuracy/compare_arms.py tests/accuracy/real_report.control.json tests/accuracy/real_report.contour-gap.json
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    Write-Host "Acceptance gates passed!" -ForegroundColor Green
} else {
    Write-Host "Acceptance gates FAILED." -ForegroundColor Red
}

exit $exitCode
