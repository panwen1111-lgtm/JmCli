@echo off
title Dousha Network MVP Launcher
echo [1/3] Starting Control Server...
start "Dousha_Server" cmd /k "node server.js"

echo [2/3] Starting Puppeteer Worker...
start "Dousha_Worker" cmd /k "node worker.js"

echo Waiting for services to initialize...
timeout /t 3 /nobreak > nul

echo [3/3] Submitting Test Task...
start "Dousha_Test_Client" cmd /k "node test_submit.js"

echo.
echo All components launched! 
echo Check the individual windows for logs.
pause
