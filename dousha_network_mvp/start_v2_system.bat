@echo off
chcp 65001 >nul
echo ====================================================
echo   Dousha Network Phase 2 - Startup
echo ====================================================
echo.
echo [1/3] Starting Central Server...
start "Dousha_Server" cmd /k "node server.js"

timeout /t 2 >nul

echo [2/3] Starting Worker A...
start "Dousha_Worker_A" cmd /k "node worker.js"

echo [3/3] Starting Worker B...
start "Dousha_Worker_B" cmd /k "node worker.js"

echo.
echo ----------------------------------------------------
echo System is ready!
echo.
echo Provider: http://localhost:3000/provider
echo Consumer: http://localhost:3000/consumer
echo ----------------------------------------------------
echo.
pause
