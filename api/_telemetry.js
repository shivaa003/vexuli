import { randomUUID } from "node:crypto";

// Durable cross-deployment global counters shared with the Node signaling
// server, so Vercel serverless instances report into one overall total.
// Only aggregate numbers — never codes, filenames, content bytes, or IPs.
const GLOBAL_COUNTER_BASE = "https://countapi.mileshilliard.com/api/v1";
const PREFIX = "vexuli-prod-v1-";
const GLOBAL_KEYS = {
  roomsCreated: `${PREFIX}rooms-created`,
  roomsPaired: `${PREFIX}rooms-paired`,
  transfers: `${PREFIX}transfers`,
  files: `${PREFIX}files`,
  texts: `${PREFIX}texts`,
  bytes: `${PREFIX}bytes`,
  signals: `${PREFIX}signals`,
  desktop: `${PREFIX}dev-desktop`,
  mobile: `${PREFIX}dev-mobile`,
  tablet: `${PREFIX}dev-tablet`,
  visits: `${PREFIX}visits`,
};
const GLOBAL_SYNC_ENABLED = process.env.DISABLE_GLOBAL_SYNC !== "1";

async function globalFetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function globalNum(value) {
  const n = value && typeof value === "object" && "value" in value ? Number(value.value) : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

async function globalGet(key) {
  try {
    return globalNum(await globalFetchJson(`${GLOBAL_COUNTER_BASE}/get/${encodeURIComponent(key)}`, 2500));
  } catch {
    return 0;
  }
}

function globalHit(key) {
  if (!GLOBAL_SYNC_ENABLED) return Promise.resolve();
  return globalFetchJson(`${GLOBAL_COUNTER_BASE}/hit/${encodeURIComponent(key)}`, 3000).catch(() => null);
}

async function globalAddBytes(bytes) {
  if (!GLOBAL_SYNC_ENABLED) return;
  const delta = Math.max(0, Math.round(Number(bytes) || 0));
  if (delta <= 0) return;
  try {
    const current = await globalGet(GLOBAL_KEYS.bytes);
    await globalFetchJson(
      `${GLOBAL_COUNTER_BASE}/set/${encodeURIComponent(GLOBAL_KEYS.bytes)}?value=${current + delta}`,
      3500,
    );
  } catch {
    /* best effort */
  }
}

let globalCache = { at: 0, totals: null };
const GLOBAL_CACHE_TTL = 25_000;

async function fetchGlobalTotals() {
  const now = Date.now();
  if (globalCache.totals && now - globalCache.at < GLOBAL_CACHE_TTL) return globalCache.totals;
  if (!GLOBAL_SYNC_ENABLED) return null;
  try {
    const entries = Object.entries(GLOBAL_KEYS);
    const values = await Promise.all(entries.map(([, key]) => globalGet(key)));
    const totals = {};
    entries.forEach(([field], i) => {
      totals[field] = values[i] || 0;
    });
    globalCache = { at: now, totals };
    return totals;
  } catch {
    return globalCache.totals;
  }
}

function generateHistory() {
  const now = Date.now();
  const initHour = new Date(now);
  initHour.setMinutes(0, 0, 0);

  const history = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(initHour.getTime() - i * 60 * 60 * 1000);
    const hour = d.getHours();
    history.push({
      label: `${String(hour).padStart(2, "0")}:00`,
      timestamp: d.getTime(),
      transfers: 0,
      bytes: 0,
      signals: 0,
      roomsCreated: 0,
      roomsPaired: 0,
    });
  }
  return history;
}

const memoryState = {
  totalRoomsCreated: 0,
  totalRoomsPaired: 0,
  totalSignalsRelayed: 0,
  totalBytesTransferred: 0,
  totalTransfersCompleted: 0,
  totalVisits: 0,
  contentStats: { files: 0, text: 0 },
  deviceStats: { desktop: 0, mobile: 0, tablet: 0, other: 0 },
  hourlyHistory: generateHistory(),
  serverStartedAt: Date.now(),
  recentEvents: [],
};

function formatBytes(value) {
  if (!value || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit === 1 ? 0 : 1)} ${["B", "KB", "MB", "GB"][unit]}`;
}

function currentBucket() {
  const now = Date.now();
  const hourStart = new Date(now).setMinutes(0, 0, 0);
  let history = memoryState.hourlyHistory;
  if (!Array.isArray(history) || history.length === 0) {
    memoryState.hourlyHistory = generateHistory();
    history = memoryState.hourlyHistory;
  }
  let last = history[history.length - 1];
  if (!last || last.timestamp < hourStart) {
    const d = new Date(hourStart);
    last = {
      label: `${String(d.getHours()).padStart(2, "0")}:00`,
      timestamp: hourStart,
      transfers: 0,
      bytes: 0,
      signals: 0,
      roomsCreated: 0,
      roomsPaired: 0,
    };
    history.push(last);
    while (history.length > 24) history.shift();
  }
  return last;
}

export async function recordTransfer({ bytes = 0, type = "file", route = "Direct P2P" }) {
  const safeBytes = Math.max(0, Math.min(100 * 1024 * 1024, Number(bytes) || 0));
  memoryState.totalBytesTransferred += safeBytes;
  memoryState.totalTransfersCompleted += 1;
  if (type === "text") memoryState.contentStats.text++;
  else memoryState.contentStats.files++;

  const bucket = currentBucket();
  bucket.transfers += 1;
  bucket.bytes += safeBytes;

  memoryState.recentEvents.unshift({
    id: randomUUID(),
    title: type === "text" ? "Encrypted Text Payload" : "Direct File Transfer Completed",
    detail: `${formatBytes(safeBytes)} transferred peer-to-peer`,
    route: route === "relay" ? "TURN Relay" : "Direct P2P",
    timestamp: Date.now(),
  });
  if (memoryState.recentEvents.length > 25) memoryState.recentEvents.pop();

  // Mirror into durable global counters (awaited briefly so serverless
  // doesn't terminate before the increment lands).
  if (GLOBAL_SYNC_ENABLED) {
    try {
      await Promise.race([
        (async () => {
          await globalHit(GLOBAL_KEYS.transfers);
          await globalHit(type === "text" ? GLOBAL_KEYS.texts : GLOBAL_KEYS.files);
          await globalAddBytes(safeBytes);
        })(),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
    } catch {
      /* best effort */
    }
  }
}

export async function recordVisit() {
  memoryState.totalVisits += 1;
  if (GLOBAL_SYNC_ENABLED) {
    try {
      await Promise.race([
        globalHit(GLOBAL_KEYS.visits),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      /* best effort */
    }
  }
}

export async function getGlobalStats() {
  const g = await fetchGlobalTotals().catch(() => null);
  const pick = (field, local) => Math.max(Number(local) || 0, Number(g?.[field]) || 0);
  return {
    overallPlatform: true,
    historyScope: "live-window",
    activeRooms: 0,
    activeClients: 0,
    totalRoomsCreated: pick("roomsCreated", memoryState.totalRoomsCreated),
    totalRoomsPaired: pick("roomsPaired", memoryState.totalRoomsPaired),
    totalSignalsRelayed: pick("signals", memoryState.totalSignalsRelayed),
    totalBytesTransferred: pick("bytes", memoryState.totalBytesTransferred),
    totalTransfersCompleted: pick("transfers", memoryState.totalTransfersCompleted),
    totalVisits: pick("visits", memoryState.totalVisits),
    contentStats: {
      files: pick("files", memoryState.contentStats.files),
      text: pick("texts", memoryState.contentStats.text),
    },
    deviceStats: {
      desktop: pick("desktop", memoryState.deviceStats.desktop),
      mobile: pick("mobile", memoryState.deviceStats.mobile),
      tablet: pick("tablet", memoryState.deviceStats.tablet),
      other: memoryState.deviceStats.other,
    },
    uptimeSeconds: Math.floor((Date.now() - memoryState.serverStartedAt) / 1000),
    serverStartedAt: memoryState.serverStartedAt,
    serverTime: Date.now(),
    hourlyHistory: memoryState.hourlyHistory,
    recentEvents: memoryState.recentEvents,
  };
}
