@echo off
REM Hourly wrapper for the ParentVUE backup sync on Windows.
REM Skips weekends (school days only); runs the Python sync otherwise.
for /f %%i in ('powershell -NoProfile -Command "(Get-Date).DayOfWeek.value__"') do set DOW=%%i
if %DOW% GEQ 6 (
  echo [%date% %time%] Weekend - skipping ParentVUE pull. >> parentvue-sync.log
  exit /b 0
)
REM Only run during 6 AM - 10 PM local
for /f "tokens=1 delims=:" %%h in ('powershell -NoProfile -Command "(Get-Date).Hour"') do set HR=%%h
if %HR% LSS 6 exit /b 0
if %HR% GTR 22 exit /b 0
python parentvue-laptop-sync.py --sync-now
