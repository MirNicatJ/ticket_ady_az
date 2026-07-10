import { readFileSync } from "node:fs";
import { readState } from "./state.js";
import { Telegram } from "./telegram.js";

function loadDotEnv(path = ".env") {
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (!process.env[key]) process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

loadDotEnv();

function configuredChatIds() {
  return [process.env.TELEGRAM_CHAT_IDS, process.env.TELEGRAM_CHAT_ID]
    .filter(Boolean)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

const state = await readState(process.env.STATE_FILE || "state.json");
const chatIds = [...new Set([...configuredChatIds(), ...(state.telegramChatIds || [])])];

const telegram = new Telegram({
  token: process.env.TELEGRAM_BOT_TOKEN,
  chatIds
});

await telegram.send(`ADY bot test message\n${new Date().toISOString()}`);
console.log(`Telegram test message sent to ${chatIds.length} chat(s).`);
