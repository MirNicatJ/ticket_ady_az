import config from "../config.json" with { type: "json" };
import { readFileSync } from "node:fs";
import { ADYClient } from "./ady-client.js";
import { diffAvailability, readState, writeState } from "./state.js";
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

const env = process.env;

const rawConsoleLog = console.log.bind(console);
const rawConsoleError = console.error.bind(console);
console.log = (...args) => rawConsoleLog(`[${new Date().toISOString()}]`, ...args);
console.error = (...args) => rawConsoleError(`[${new Date().toISOString()}]`, ...args);

const pollIntervalMs = Number(env.POLL_INTERVAL_MS || 3 * 60 * 1000);
const daysAhead = Number(env.DAYS_AHEAD || 45);
const listCheckDays = Number(env.LIST_CHECK_DAYS || 14);
const stateFile = env.STATE_FILE || "state.json";
const headless = String(env.HEADLESS || "true").toLowerCase() !== "false";
const summaryEveryPoll = String(env.SUMMARY_EVERY_POLL || "false").toLowerCase() !== "false";
const includeCalendarOnly = String(env.INCLUDE_CALENDAR_ONLY || "false").toLowerCase() === "true";
const telegramSyncIntervalMs = Number(env.TELEGRAM_SYNC_INTERVAL_MS || 10 * 1000);
const once = process.argv.includes("--once");
let subscriberSyncPromise = null;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(startIso, days) {
  const date = new Date(`${startIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function configuredDates() {
  const explicit = (env.WATCH_DATES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;

  const start = todayIso();
  return Array.from({ length: daysAhead }, (_, index) => addDaysIso(start, index));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function configuredChatIds() {
  return [env.TELEGRAM_CHAT_IDS, env.TELEGRAM_CHAT_ID]
    .filter(Boolean)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function chatFromUpdate(update) {
  return update.message?.chat || update.edited_message?.chat || update.channel_post?.chat || null;
}

async function syncTelegramSubscribers(telegram, state) {
  const updates = await telegram.getUpdates(state.telegramUpdateOffset);
  const chatIds = new Set([...(state.telegramChatIds || []).map(String), ...configuredChatIds()]);
  let nextOffset = state.telegramUpdateOffset || 0;

  for (const update of updates) {
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    const chat = chatFromUpdate(update);
    if (!chat?.id) continue;

    const chatId = String(chat.id);
    if (!chatIds.has(chatId)) {
      chatIds.add(chatId);
      for (const message of buildWelcomeMessages(state)) {
        await telegram.sendTo(chatId, message);
      }
    } else if (update.message?.text) {
      for (const message of buildWelcomeMessages(state)) {
        await telegram.sendTo(chatId, message);
      }
    }
  }

  const configured = new Set(configuredChatIds());
  return {
    ...state,
    telegramChatIds: [...chatIds].filter((chatId) => !configured.has(chatId)).sort(),
    telegramUpdateOffset: nextOffset
  };
}

async function syncAndPersistTelegramSubscribers(telegram) {
  subscriberSyncPromise ||= (async () => {
    const state = await readState(stateFile);
    const nextState = await syncTelegramSubscribers(telegram, state);
    const latestState = await readState(stateFile);
    const mergedState = {
      ...latestState,
      telegramChatIds: nextState.telegramChatIds || [],
      telegramUpdateOffset: nextState.telegramUpdateOffset
    };
    await writeState(stateFile, mergedState);
    telegram.setChatIds([...configuredChatIds(), ...(mergedState.telegramChatIds || [])]);
    return mergedState;
  })().finally(() => {
    subscriberSyncPromise = null;
  });

  return subscriberSyncPromise;
}

function startTelegramSubscriberLoop(telegram) {
  let running = false;

  async function run() {
    if (running) return;
    running = true;
    try {
      await syncAndPersistTelegramSubscribers(telegram);
    } catch (error) {
      console.error(`[Telegram] ${error.stack || error.message}`);
    } finally {
      running = false;
    }
  }

  run();
  return setInterval(run, telegramSyncIntervalMs);
}

function toAdyDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function buildTicketSearchUrl(route, isoDate) {
  const language = env.ADY_LINK_LANGUAGE || "az";
  const fromSlug = route.fromSlug || route.fromStation.slug;
  const toSlug = route.toSlug || route.toStation.slug;
  const query = new URLSearchParams({
    from_station: String(route.fromStation.value),
    to_station: String(route.toStation.value),
    date: toAdyDate(isoDate),
    return_date: "",
    two_way: "false",
    child: "0",
    infant: "0",
    adults: "1"
  });
  return `https://ticket.ady.az/${language}/ticket-search/${fromSlug}-${toSlug}?${query}`;
}

function buildCalendarItem(route, item) {
  const url = buildTicketSearchUrl(route, item.date);
  return {
    key: `${route.name}|${item.date}|calendar`,
    route: route.name,
    date: item.date,
    source: "calendar",
    url,
    free: null,
    price: item.minAmount || null,
    text:
      `${route.name}\n` +
      `${item.date}\n` +
      `Visible in ADY calendar` +
      (item.minAmount ? `, from ${item.minAmount} AZN` : "")
  };
}

function buildTrainItem(route, item) {
  const url = buildTicketSearchUrl(route, item.date);
  return {
    key: `${route.name}|${item.date}|train|${item.tripId}|${item.wagonTypeId}|${item.seatClassId}`,
    route: route.name,
    date: item.date,
    source: "train",
    url,
    free: item.free,
    price: item.minPrice || null,
    text:
      `${route.name}\n` +
      `${item.date}\n` +
      `Train ${item.trainNumber || item.tripId}: ${item.free} free seat(s)` +
      (item.minPrice ? `, from ${item.minPrice} AZN` : "")
  };
}

function formatSummaryLine(item, index) {
  const source = item.source === "calendar" ? "calendar" : "train list";
  const free =
    item.free === null || item.free === undefined
      ? ", seat count unavailable"
      : `, ${item.free} seat(s)`;
  const price = item.price ? `, from ${item.price} AZN` : "";
  return `${index + 1}. ${item.route} | ${item.date} | ${source}${free}${price}\n${item.url}`;
}

function formatBakuTime(value = new Date()) {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Baku",
    hour12: false
  });
}

function buildSummaryMessages(items) {
  const knownSeats = items.reduce((total, item) => total + (Number(item.free) || 0), 0);
  const calendarOnly = items.filter((item) => item.source === "calendar").length;
  const checkedAt = formatBakuTime();
  const header =
    `ADY availability summary\n` +
    `Checked: ${checkedAt} Baku time\n` +
    `Total availability entries: ${items.length}\n` +
    `Known free seats from train list: ${knownSeats}` +
    (calendarOnly ? `\nCalendar-only entries: ${calendarOnly} (seat count unavailable)` : "") +
    `\n`;

  if (!items.length) return [`${header}\nNo Baku <-> Tbilisi availability found.`];

  const lines = items
    .slice()
    .sort((a, b) => `${a.date}|${a.route}|${a.source}`.localeCompare(`${b.date}|${b.route}|${b.source}`))
    .map(formatSummaryLine);

  const presentRoutes = new Set(items.map((item) => item.route));
  const missingRouteLines = config.routes
    .filter((route) => !presentRoutes.has(route.name))
    .map((route) => `No ${route.name} availability found.`);

  const messages = [];
  let current = header;
  for (const line of [...missingRouteLines, ...lines]) {
    const next = `${current}\n${line}\n`;
    if (next.length > 3500 && current !== header) {
      messages.push(current.trim());
      current = `${header}\n${line}\n`;
    } else {
      current = next;
    }
  }
  messages.push(current.trim());
  return messages;
}

function buildWelcomeMessages(state) {
  const snapshot = state.lastAvailabilityItems || [];
  const intro =
    "Subscribed. I will send new ADY Baku <-> Tbilisi one-way ticket availability updates when they appear.";

  if (!snapshot.length) {
    if (state.lastCheckedAt) {
      return [
        `${intro}\n\nLast checked: ${formatBakuTime(state.lastCheckedAt)} Baku time.\n` +
          "No confirmed train-list seat availability is available right now."
      ];
    }

    const minutes = Math.max(1, Math.round(pollIntervalMs / 60000));
    return [
      `${intro}\n\nI do not have a saved availability snapshot yet. I will scan ADY within about ${minutes} minute(s).`
    ];
  }

  const [first, ...rest] = buildSummaryMessages(snapshot);
  return [`${intro}\n\nCurrent availability:\n\n${first}`, ...rest];
}

async function collectAvailability(client) {
  const dates = new Set(configuredDates());
  const explicitDates = Boolean((env.WATCH_DATES || "").trim());
  const current = [];

  for (const routeConfig of config.routes) {
    const route = await client.resolveRoute(routeConfig);
    console.log(
      `[ADY] ${route.name}: ${route.fromStation.name || route.fromStation.value} -> ` +
        `${route.toStation.name || route.toStation.value}`
    );

    const calendar = await client.getCalendarAvailability(route);
    const calendarDates = [...new Set(calendar.map((item) => item.date).filter((date) => dates.has(date)))];
    const listDates = (explicitDates ? [...dates] : calendarDates).slice(0, listCheckDays);
    let calendarOnlyCount = 0;
    for (const item of calendar) {
      if (!dates.has(item.date)) continue;
      if (includeCalendarOnly) {
        current.push(buildCalendarItem(route, item));
      } else {
        calendarOnlyCount += 1;
      }
    }
    if (calendarOnlyCount) {
      console.log(`[ADY] ${route.name}: ignored ${calendarOnlyCount} calendar-only hint(s)`);
    }
    console.log(`[ADY] ${route.name}: checking ${listDates.length} hinted date(s) for seats`);

    for (const date of listDates) {
      await sleep(Number(env.REQUEST_DELAY_MS || 1500));
      const trainSeats = await client.getTrainAvailability(route, date);
      for (const item of trainSeats) current.push(buildTrainItem(route, item));
    }
  }

  return current;
}

function createAdyClient() {
  return new ADYClient({
    language: env.ADY_LANGUAGE || "az",
    headless,
    browserChannel: env.BROWSER_CHANNEL || null,
    readyTimeoutMs: Number(env.ADY_READY_TIMEOUT_MS || 300000)
  });
}

async function tick(telegram, client) {
  console.log("[ADY] Scan started");
  const state = await syncAndPersistTelegramSubscribers(telegram);

  const current = await collectAvailability(client);
  const { newItems, nextState } = diffAvailability(state, current);
  if (newItems.length) console.log(`[ADY] Sending ${newItems.length} new availability notification(s)`);

  for (const item of newItems) {
    await telegram.send(`New ADY ticket availability\n\n${item.text}\n\nBuy/search:\n${item.url}`);
  }

  if (summaryEveryPoll) {
    for (const message of buildSummaryMessages(current)) {
      await telegram.send(message);
    }
  }

  const latestState = await readState(stateFile);
  await writeState(stateFile, {
    ...nextState,
    telegramChatIds: latestState.telegramChatIds || [],
    telegramUpdateOffset: latestState.telegramUpdateOffset,
    lastAvailabilityItems: current,
    lastCheckedAt: new Date().toISOString(),
    lastCount: current.length
  });
  console.log(`[ADY] ${current.length} available item(s), ${newItems.length} new`);
}

async function main() {
  const telegram = new Telegram({
    token: env.TELEGRAM_BOT_TOKEN
  });
  const subscriberInterval = once ? null : startTelegramSubscriberLoop(telegram);
  let client = null;

  try {
    do {
      try {
        if (!client) {
          client = createAdyClient();
          await client.start();
        }
        await tick(telegram, client);
      } catch (error) {
        console.error(`[ADY] ${error.stack || error.message}`);
        await client?.close().catch(() => {});
        client = null;
      }
      if (!once) await sleep(pollIntervalMs);
    } while (!once);
  } finally {
    if (subscriberInterval) clearInterval(subscriberInterval);
    await client?.close().catch(() => {});
  }
}

main();
