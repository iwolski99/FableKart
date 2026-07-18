@echo off
REM Double-click this file to launch FableKart (Windows).
REM First run installs dependencies automatically; every run after that is instant.
cd /d "%~dp0"

if not exist node_modules (
  echo First run - installing dependencies ^(this can take a minute^)...
  call npm install
)

echo.
echo Starting FableKart... a browser tab will open automatically.
echo Keep this window open while you play. Close it to stop the game.
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5173/"
call npm run dev
