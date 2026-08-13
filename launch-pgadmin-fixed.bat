@echo off
REM Launches pgAdmin 4 with the correct working directory so that
REM the internal 'pgadmin' Python package can be imported.
REM
REM If you installed PostgreSQL/pgAdmin to a custom path, update the
REM PYTHONPATH and the working directory below before running.

set "PGADMIN_ROOT=C:\Program Files\PostgreSQL\14\pgAdmin 4"
set "PYTHONPATH=%PGADMIN_ROOT%\web"
set "PYTHON_EXE=%PGADMIN_ROOT%\python\python.exe"
set "WEB_DIR=%PGADMIN_ROOT%\web"

echo Launching pgAdmin from: %WEB_DIR%
"%PYTHON_EXE%" -s "%WEB_DIR%\pgAdmin4.py"

pause
