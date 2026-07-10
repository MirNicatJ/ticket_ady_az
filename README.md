# ADY Telegram Ticket Bot

This bot watches `ticket.ady.az` for Baku <-> Tbilisi tickets and sends Telegram messages when confirmed train-list seat availability appears.

ADY protects `/ticket-api/*` with reCAPTCHA v3, so the bot uses Playwright to open the real site and make the same browser-side API calls the site makes. It checks both:

- calendar hints from `/ticket-api/get_trip_dates`
- confirmed train-list seat availability from `/ticket-api/get_traintrip`

## Setup

```powershell
cd C:\dev\ticket.ady.az
npm install
npx playwright install chromium
Copy-Item .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Get `TELEGRAM_CHAT_ID` by messaging your bot, then opening:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
```

## Run

One check:

```powershell
npm start -- --once
```

Continuous polling:

```powershell
npm start
```

## One-click Windows Run

For a Windows desktop PC:

1. Install Node.js LTS from `https://nodejs.org/`.
2. Double-click `install-once.bat`.
3. Edit `.env` and set `TELEGRAM_BOT_TOKEN`.
4. Double-click `run-bot.bat`.

Helpful launchers:

- `run-bot.bat` starts the bot in a visible console.
- `install-once.bat` installs Node dependencies and Playwright Chromium.
- `check-bot.bat` shows active bot processes and recent logs.
- `stop-bot.bat` stops background bot processes.

## AWS Deployment

For AWS, use the Docker-based Lightsail path in `AWS-LIGHTSAIL.md`.

The included `Dockerfile` uses the official Playwright image, so Chromium and its Linux dependencies are already installed.

## Low-bandwidth tuning

For slow or metered internet, set exact travel dates instead of scanning a horizon:

```env
WATCH_DATES=2026-07-10,2026-07-12,2026-07-18
LIST_CHECK_DAYS=3
POLL_INTERVAL_MS=1800000
```

If `WATCH_DATES` is empty, the bot checks the next `DAYS_AHEAD` dates in the calendar and the first `LIST_CHECK_DAYS` dates in the train list.

By default, Telegram alerts use only confirmed train-list seats. ADY calendar hints can show dates/prices even when the ticket page has no buyable seats. To include those hints anyway, set:

```env
INCLUDE_CALENDAR_ONLY=true
```

If ADY shows a Cloudflare verification page to Playwright's bundled browser, set:

```env
BROWSER_CHANNEL=chrome
```

Use `msedge` instead if Chrome is not installed.

## Notes

- Keep polling conservative. A 15-30 minute interval is reasonable.
- If ADY changes their frontend, update `src/ady-client.js`; the API paths are isolated there.
- The bot stores current availability in `state.json` and only alerts when an item appears that was not present on the previous run.
