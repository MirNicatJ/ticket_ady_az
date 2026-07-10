@echo off
setlocal
title Stop ADY Ticket Bot
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-bot.ps1"

echo.
pause
