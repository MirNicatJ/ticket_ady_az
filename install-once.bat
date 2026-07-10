@echo off
setlocal
title Install ADY Ticket Bot
cd /d "%~dp0"

echo Installing ADY Ticket Bot dependencies...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js LTS from https://nodejs.org/ and run this again.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo Created .env from .env.example.
    echo Edit .env and set TELEGRAM_BOT_TOKEN before running the bot.
    echo.
  )
)

call npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

call npx playwright install chromium
if errorlevel 1 (
  echo Playwright Chromium install failed.
  pause
  exit /b 1
)

echo.
echo Install complete.
echo You can now run run-bot.bat.
pause
