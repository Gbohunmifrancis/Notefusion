$env:LOCUST_AUDIO_FILE = "C:\Users\ADMIN\OneDrive\Desktop\PROJECTS\Note\server\tests\accuracy\real\harness_stand_in_1.wav"
$env:LOCUST_MODE = "melody"
$env:LOCUST_TIME_SIGNATURE = "4/4"
$env:LOCUST_TEMPO = "120"
$env:LOCUST_POLL_INTERVAL = "1"
$env:LOCUST_POLL_TIMEOUT = "60"
$hostUrl = "https://notefusion-transcriber-ef80c63d506f.herokuapp.com"

Write-Host "Running COLD, FIRST REQUEST (u=1, t=20s)..."
python -m locust -f server/loadtest/locustfile.py --host $hostUrl --headless -u 1 -r 1 -t 20s --csv=results_cold

Write-Host "Waiting 5 seconds..."
Start-Sleep -Seconds 5

Write-Host "Running WARM, SEQUENTIAL (u=1, t=30s)..."
python -m locust -f server/loadtest/locustfile.py --host $hostUrl --headless -u 1 -r 1 -t 30s --csv=results_warm

Write-Host "Waiting 5 seconds..."
Start-Sleep -Seconds 5

Write-Host "Running WARM, CONCURRENCY 2 (u=2, t=30s)..."
python -m locust -f server/loadtest/locustfile.py --host $hostUrl --headless -u 2 -r 2 -t 30s --csv=results_c2

Write-Host "Waiting 5 seconds..."
Start-Sleep -Seconds 5

Write-Host "Running WARM, CONCURRENCY 4 (u=4, t=30s)..."
python -m locust -f server/loadtest/locustfile.py --host $hostUrl --headless -u 4 -r 4 -t 30s --csv=results_c4

Write-Host "Waiting 5 seconds..."
Start-Sleep -Seconds 5

Write-Host "Running WARM, CONCURRENCY 8 (u=8, t=30s)..."
python -m locust -f server/loadtest/locustfile.py --host $hostUrl --headless -u 8 -r 8 -t 30s --csv=results_c8

