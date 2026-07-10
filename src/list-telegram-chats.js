import { readFileSync } from "node:fs";

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

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
if (!response.ok) {
  throw new Error(`getUpdates failed: ${response.status} ${await response.text()}`);
}

const data = await response.json();
const chats = new Map();
for (const update of data.result || []) {
  const chat = update.message?.chat || update.edited_message?.chat || update.channel_post?.chat;
  if (!chat?.id) continue;
  chats.set(String(chat.id), {
    id: chat.id,
    type: chat.type,
    name: [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.title || chat.username || ""
  });
}

if (!chats.size) {
  console.log("No chats found. Ask the person to send a message to the bot first.");
} else {
  for (const chat of chats.values()) {
    console.log(`${chat.id}\t${chat.type}\t${chat.name}`);
  }
}
