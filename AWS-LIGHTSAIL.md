# AWS Lightsail Deployment

This is the cheapest simple AWS deployment path for the ADY Telegram bot.

## Why Lightsail

Lightsail is a small VPS. It is simpler than ECS/Fargate and works well for this bot because:

- the bot is a long-running process, not a website
- Playwright/Chromium is easier in Docker on a normal Linux host
- `state.json` can persist on the instance disk
- pricing is predictable

Use at least the 1 GB RAM Linux bundle. If Chromium crashes or gets killed, move to 2 GB RAM.

## 1. Create the instance

1. Open AWS Lightsail.
2. Create instance.
3. Platform: Linux/Unix.
4. Blueprint: OS Only -> Ubuntu.
5. Plan: start with 1 GB RAM.
6. Name it `ady-ticket-bot`.

No inbound ports are needed for the bot. It only makes outbound HTTPS requests.

## 2. SSH into the instance

Use the browser SSH button in Lightsail, or SSH from your terminal.

## 3. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
sudo usermod -aG docker ubuntu
```

Log out and back in so the `docker` group applies.

## 4. Get the code onto the server

Push this folder to a GitHub repo, then clone it:

```bash
git clone https://github.com/YOUR_USER/ady-telegram-bot.git
cd ady-telegram-bot
```

## 5. Create environment file

```bash
cp .env.example .env
nano .env
```

Set:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
POLL_INTERVAL_MS=900000
DAYS_AHEAD=45
LIST_CHECK_DAYS=14
HEADLESS=true
STATE_FILE=/data/state.json
```

For lower traffic, use exact dates:

```env
WATCH_DATES=2026-07-10,2026-07-12
LIST_CHECK_DAYS=2
POLL_INTERVAL_MS=1800000
```

## 6. Build and run

```bash
mkdir -p ~/ady-ticket-bot-data
docker build -t ady-ticket-bot .
docker run -d \
  --name ady-ticket-bot \
  --restart unless-stopped \
  --env-file .env \
  -v ~/ady-ticket-bot-data:/data \
  ady-ticket-bot
```

## 7. Check logs

```bash
docker logs -f ady-ticket-bot
```

## Update later

```bash
cd ~/ady-telegram-bot
git pull
docker build -t ady-ticket-bot .
docker stop ady-ticket-bot
docker rm ady-ticket-bot
docker run -d \
  --name ady-ticket-bot \
  --restart unless-stopped \
  --env-file .env \
  -v ~/ady-ticket-bot-data:/data \
  ady-ticket-bot
```

## Stop/delete

```bash
docker stop ady-ticket-bot
docker rm ady-ticket-bot
```
