@echo off
setlocal
title Check ADY Ticket Bot
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-bot.ps1"

echo.
pause
