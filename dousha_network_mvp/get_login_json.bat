@echo off
setlocal
cd /d "%~dp0"

echo ====================================================
echo   Dousha Network - CLI Session 获取工具 (增强版)
echo ====================================================
echo.
echo [1/2] 正在检测 dreamina.exe 路径...

set EXE_PATH=..\dreamina.exe

if exist "%EXE_PATH%" (
    echo [OK] 找到执行文件: %EXE_PATH%
) else (
    echo [ERROR] 找不到执行文件! 
    echo 请确认 dreamina.exe 是否在 JmCli 根目录下。
    pause
    exit /b
)

echo [2/2] 启动登录程序...
echo ----------------------------------------------------
echo.

"%EXE_PATH%" login --debug

echo.
echo ----------------------------------------------------
echo.
echo 如果上方输出了 JSON，请将其复制并粘贴到 test_submit.js。
echo 如果没有看到 JSON，请检查网络并重试。
pause
