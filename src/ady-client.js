import { chromium } from "playwright";

const AZERI_CHAR_MAP = [
  [/\u0131/g, "i"],
  [/\u0130/g, "i"],
  [/\u0259/g, "e"],
  [/\u018f/g, "e"],
  [/\u011f/g, "g"],
  [/\u011e/g, "g"],
  [/\u00f6/g, "o"],
  [/\u00d6/g, "o"],
  [/\u00fc/g, "u"],
  [/\u00dc/g, "u"],
  [/\u00e7/g, "c"],
  [/\u00c7/g, "c"],
  [/\u015f/g, "s"],
  [/\u015e/g, "s"]
];

export function normalizeStationName(value) {
  let normalized = String(value || "").toLowerCase();
  for (const [pattern, replacement] of AZERI_CHAR_MAP) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/[^a-z0-9]+/g, " ").trim();
}

function stationLabel(station) {
  return station?.data_value || station?.name || station?.slug || station?.value;
}

function findStation(stations, aliases) {
  const normalizedAliases = aliases.map(normalizeStationName);
  const exact = stations.find((station) => {
    const name = normalizeStationName(stationLabel(station));
    return normalizedAliases.includes(name);
  });
  if (exact) return exact;

  return stations.find((station) => {
    const name = normalizeStationName(stationLabel(station));
    return normalizedAliases.some((alias) => name.includes(alias) || alias.includes(name));
  });
}

function findStationByIdOrAlias(stations, id, aliases) {
  if (id) {
    const byId = stations.find((station) => Number(station.value) === Number(id));
    if (byId) return byId;
  }
  return findStation(stations, aliases);
}

function flattenTripDates(input, output = []) {
  if (!input) return output;
  if (Array.isArray(input)) {
    for (const item of input) flattenTripDates(item, output);
    return output;
  }
  if (typeof input === "object") {
    if (input.trip_date) output.push(input);
    for (const value of Object.values(input)) flattenTripDates(value, output);
  }
  return output;
}

function toIsoDateFromAdy(value) {
  const match = String(value || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function summarizeTrain(train) {
  const seats = [];
  for (const [wagonTypeId, bySeatClass] of Object.entries(train.wagon || {})) {
    for (const [seatClassId, details] of Object.entries(bySeatClass || {})) {
      const wagonSeats = Array.isArray(details?.wagons)
        ? details.wagons.reduce((total, wagon) => total + (Number(wagon?.free_seats_count) || 0), 0)
        : 0;
      const free = wagonSeats || Number(details?.free_seats_count || 0);
      if (free > 0) {
        seats.push({
          wagonTypeId,
          seatClassId,
          free,
          minPrice: details?.min_price || details?.tam_st_alt || details?.tam_st_ust || null
        });
      }
    }
  }
  return seats;
}

function isNoAvailabilityError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    (message.includes("bilet") && message.includes("sat")) ||
    message.includes("butun biletler satilib") ||
    message.includes("all tickets") ||
    message.includes("no tickets") ||
    message.includes("no data")
  );
}

function isRecaptchaError(error) {
  return String(error?.message || "").toLowerCase().includes("recaptcha");
}

export class ADYClient {
  constructor({
    baseUrl = "https://ticket.ady.az",
    language = "az",
    headless = true,
    browserChannel = null,
    readyTimeoutMs = 300000
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.language = language;
    this.headless = headless;
    this.browserChannel = browserChannel;
    this.readyTimeoutMs = readyTimeoutMs;
    this.browser = null;
    this.page = null;
    this.routeCache = new Map();
  }

  async start() {
    this.browser = await chromium.launch({
      headless: this.headless,
      ...(this.browserChannel ? { channel: this.browserChannel } : {})
    });
    this.page = await this.browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "Chrome/124.0.0.0 Safari/537.36"
    });
    await this.page.goto(`${this.baseUrl}/${this.language}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await this.page.waitForFunction(() => window.grecaptcha && window.g_token, null, {
      timeout: this.readyTimeoutMs
    });
  }

  async close() {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
    this.routeCache.clear();
  }

  async apiPost(path, payload) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await this.page.evaluate(
        async ({ path, payload }) => {
          const token = await new Promise((resolve, reject) => {
            window.grecaptcha.ready(() => {
              window.grecaptcha.execute(window.g_token, { action: "ticket_api" }).then(resolve, reject);
            });
          });

          const response = await fetch(path, {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              "x-requested-with": "XMLHttpRequest"
            },
            body: JSON.stringify({ ...payload, g_token: token })
          });
          const text = await response.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { error: true, message: text };
          }
          return { ok: response.ok, status: response.status, data };
        },
        { path, payload }
      );

      if (result.ok && !result.data?.error) return result.data;

      lastError = new Error(
        `ADY ${path} failed: ${result.status} ${result.data?.message || JSON.stringify(result.data)}`
      );
      if (!isRecaptchaError(lastError) || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }

    throw lastError;
  }

  async resolveRoute(routeConfig) {
    const cacheKey = `${routeConfig.fromId || routeConfig.from}|${routeConfig.toId || routeConfig.to}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached) return cached;

    const fromResponse = await this.apiPost("/ticket-api/stations_in_route", {
      field: "#from_station",
      station_id: 0
    });
    const fromStation = findStationByIdOrAlias(
      fromResponse.data || [],
      routeConfig.fromId,
      routeConfig.from
    );
    if (!fromStation) {
      throw new Error(`Could not find from station for ${routeConfig.name}`);
    }

    const toResponse = await this.apiPost("/ticket-api/stations_in_route", {
      field: "#to_station",
      station_id: fromStation.value
    });
    const toStation = findStationByIdOrAlias(
      toResponse.data || [],
      routeConfig.toId,
      routeConfig.to
    );
    if (!toStation) {
      throw new Error(`Could not find to station for ${routeConfig.name}`);
    }

    const route = { ...routeConfig, fromStation, toStation };
    this.routeCache.set(cacheKey, route);
    return route;
  }

  async getCalendarAvailability(route) {
    let response;
    try {
      response = await this.apiPost("/ticket-api/get_trip_dates", {
        from_station: route.fromStation.value,
        to_station: route.toStation.value,
        way: 1
      });
    } catch (error) {
      if (isNoAvailabilityError(error)) return [];
      throw error;
    }

    return flattenTripDates(response.data)
      .map((item) => ({
        date: toIsoDateFromAdy(item.trip_date),
        minAmount: item.min_amount,
        coefficient: item.min_cofficient
      }))
      .filter((item) => item.date);
  }

  async getTrainAvailability(route, isoDate) {
    let response;
    try {
      response = await this.apiPost("/ticket-api/get_traintrip", {
        from_station: route.fromStation.value,
        to_station: route.toStation.value,
        trip_date: isoDate,
        check: true
      });
    } catch (error) {
      if (isNoAvailabilityError(error)) return [];
      if (isRecaptchaError(error)) {
        console.error(`[ADY] Skipping train list for ${route.name} ${isoDate}: ${error.message}`);
        return [];
      }
      throw error;
    }

    const trains = Object.values(response.data || {});
    return trains.flatMap((train) => {
      const seats = summarizeTrain(train);
      return seats.map((seat) => ({
        date: isoDate,
        trainNumber: train.train_number || train.name || train.number || train.trip_id,
        depart: train.depart_datetime,
        arrive: train.arrival_datetime,
        tripId: train.trip_id,
        ...seat
      }));
    });
  }
}
