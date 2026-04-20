@echo off
title Dousha Cloud Center - Server
color 0D

echo ====================================================
echo    Dousha Network Cloud Center (All-in-One)
echo ====================================================

:: Check dependencies
if not exist node_modules (
    echo [System] Installing dependencies, please wait...
    npm install
)

:: Run Server
echo [System] Starting Server and Internal Runner engine...
node server.js

if %errorlevel% neq 0 (
    echo [Error] Server stopped unexpectedly!
    pause
)
