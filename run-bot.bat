@echo off
setlocal
title ADY Ticket Bot
cd /d "%~dp0"

echo Starting ADY Ticket Bot...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js LTS from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Dependencies are not installed.
  echo Run install-once.bat first.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo .env was not found.
  echo Copy .env.example to .env and fill in TELEGRAM_BOT_TOKEN.
  echo.
  pause
  exit /b 1
)

echo.>>bot.log
echo === Bot start %date% %time% ===>>bot.log
npm start >>bot.log 2>&1
echo.
echo Bot stopped.
pause
