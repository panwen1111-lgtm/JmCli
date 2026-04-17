@echo off
chcp 65001 >nul
echo ====================================================
echo   Dousha Network - CLI Session Helper (Root)
echo ====================================================
echo.
echo Starting dreamina.exe...
echo.

dreamina.exe login --debug

echo.
echo ----------------------------------------------------
echo If you see a JSON payload, COPY AND PASTE it into:
echo   dousha_network_mvp/test_submit.js
echo.
pause
