set LOCUST_AUDIO_FILE=%CD%\server\tests\accuracy\real\harness_stand_in_1.wav
set LOCUST_MODE=melody
set LOCUST_TIME_SIGNATURE=4/4
set LOCUST_TEMPO=120
set LOCUST_POLL_INTERVAL=1
set LOCUST_POLL_TIMEOUT=60
set HOST_URL=https://notefusion-transcriber-ef80c63d506f.herokuapp.com

echo Running COLD, FIRST REQUEST (u=1, t=30s)...
python -m locust -f server/loadtest/locustfile.py --host %HOST_URL% --headless -u 1 -r 1 -t 30s --csv=results_cold

echo Waiting 5 seconds...
timeout /t 5

echo Running WARM, SEQUENTIAL (u=1, t=40s)...
python -m locust -f server/loadtest/locustfile.py --host %HOST_URL% --headless -u 1 -r 1 -t 40s --csv=results_warm

echo Waiting 5 seconds...
timeout /t 5

echo Running WARM, CONCURRENCY 2 (u=2, t=40s)...
python -m locust -f server/loadtest/locustfile.py --host %HOST_URL% --headless -u 2 -r 2 -t 40s --csv=results_c2

echo Waiting 5 seconds...
timeout /t 5

echo Running WARM, CONCURRENCY 4 (u=4, t=40s)...
python -m locust -f server/loadtest/locustfile.py --host %HOST_URL% --headless -u 4 -r 4 -t 40s --csv=results_c4

echo Waiting 5 seconds...
timeout /t 5

echo Running WARM, CONCURRENCY 8 (u=8, t=40s)...
python -m locust -f server/loadtest/locustfile.py --host %HOST_URL% --headless -u 8 -r 8 -t 40s --csv=results_c8

