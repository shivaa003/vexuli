import { createHmac, randomInt, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INDEX = join(ROOT, "dist", "index.html");
const PORT = Number(process.env.PORT || 3001);
const ROOM_LIFETIME = 5 * 60 * 1000;
const JOIN_WINDOW = 60 * 1000;
const JOIN_LIMIT = 5;
const JOIN_LOCK = 5 * 60 * 1000;
const MAX_ROOMS_PER_IP = 3;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_CHARS = 4000;
const WORDS = [
  "amber", "anchor", "apple", "arrow", "bamboo", "beacon", "bloom", "blue", "branch", "breeze",
  "bridge", "candle", "cedar", "cloud", "coast", "coral", "crystal", "dawn", "dune", "ember",
  "fern", "field", "finch", "flame", "forest", "garden", "globe", "harbor", "honey", "island",
  "jungle", "kite", "lagoon", "lantern", "leaf", "light", "lunar", "maple", "meadow", "mist",
  "moon", "moss", "north", "ocean", "olive", "orbit", "pearl", "pine", "prism", "quiet",
  "river", "robin", "shore", "silver", "solar", "spark", "stone", "sunset", "tide", "violet",
  "wave", "willow", "winter", "zenith",
];

const rooms = new Map();
const limits = new Map();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });

const DATA_DIR = join(ROOT, "server", "data");
const TELEMETRY_FILE = process.env.TELEMETRY_FILE || join(DATA_DIR, "global-telemetry.json");

function generateInitialGlobalState() {
  // Real zero baseline: every number below is earned by genuine usage.
  // Hourly buckets start empty and fill in as real rooms/transfers occur.
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

  return {
    totalRoomsCreated: 0,
    totalRoomsPaired: 0,
    totalSignalsRelayed: 0,
    totalBytesTransferred: 0,
    totalTransfersCompleted: 0,
    totalVisits: 0,
    contentStats: { files: 0, text: 0 },
    deviceStats: { desktop: 0, mobile: 0, tablet: 0, other: 0 },
    hourlyHistory: history,
    recentEvents: [],
  };
}

// ---------------------------------------------------------------------------
// Durable cross-deployment global counters (all users, past → up-to-date).
// The on-disk file covers this node; these public aggregate counters unite
// every deployment (Render Node + Vercel serverless) into one overall total.
// Only numbers are stored — never codes, filenames, bytes of content, or IPs.
// ---------------------------------------------------------------------------
const GLOBAL_COUNTER_BASE = "https://countapi.mileshilliard.com/api/v1";
const GLOBAL_PREFIX = "vexuli-prod-v1-";
const GLOBAL_KEYS = {
  roomsCreated: `${GLOBAL_PREFIX}rooms-created`,
  roomsPaired: `${GLOBAL_PREFIX}rooms-paired`,
  transfers: `${GLOBAL_PREFIX}transfers`,
  files: `${GLOBAL_PREFIX}files`,
  texts: `${GLOBAL_PREFIX}texts`,
  bytes: `${GLOBAL_PREFIX}bytes`,
  signals: `${GLOBAL_PREFIX}signals`,
  desktop: `${GLOBAL_PREFIX}dev-desktop`,
  mobile: `${GLOBAL_PREFIX}dev-mobile`,
  tablet: `${GLOBAL_PREFIX}dev-tablet`,
  visits: `${GLOBAL_PREFIX}visits`,
};
const GLOBAL_SYNC_ENABLED =
  process.env.DISABLE_GLOBAL_SYNC !== "1" && process.env.NODE_ENV === "production";

async function globalFetchJson(url, timeoutMs, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
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
    return globalNum(await globalFetchJson(`${GLOBAL_COUNTER_BASE}/get/${encodeURIComponent(key)}`, 3000));
  } catch {
    return 0;
  }
}

function globalHit(key) {
  if (!GLOBAL_SYNC_ENABLED) return;
  globalFetchJson(`${GLOBAL_COUNTER_BASE}/hit/${encodeURIComponent(key)}`, 3500).catch(() => {});
}

function globalAddBytes(bytes) {
  if (!GLOBAL_SYNC_ENABLED) return;
  const delta = Math.max(0, Math.round(Number(bytes) || 0));
  if (delta <= 0) return;
  (async () => {
    try {
      const current = await globalGet(GLOBAL_KEYS.bytes);
      await globalFetchJson(
        `${GLOBAL_COUNTER_BASE}/set/${encodeURIComponent(GLOBAL_KEYS.bytes)}?value=${current + delta}`,
        4000,
      );
    } catch {
      /* best effort */
    }
  })();
}

let globalCache = { at: 0, totals: null };
const GLOBAL_CACHE_TTL = 20_000;

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

function refreshGlobalCacheInBackground() {
  if (!GLOBAL_SYNC_ENABLED) return;
  const now = Date.now();
  if (globalCache.totals && now - globalCache.at < GLOBAL_CACHE_TTL) return;
  globalCache.at = now; // prevent stampede; fetch updates totals below
  (async () => {
    try {
      const entries = Object.entries(GLOBAL_KEYS);
      const values = await Promise.all(entries.map(([, key]) => globalGet(key)));
      const totals = {};
      entries.forEach(([field], i) => {
        totals[field] = values[i] || 0;
      });
      globalCache = { at: Date.now(), totals };
    } catch {
      globalCache.at = 0;
    }
  })();
}

function mergedOverallTotals() {
  const g = globalCache.totals || {};
  const pick = (field, local) => Math.max(Number(local) || 0, Number(g[field]) || 0);
  return {
    totalRoomsCreated: pick("roomsCreated", globalTelemetry.totalRoomsCreated),
    totalRoomsPaired: pick("roomsPaired", globalTelemetry.totalRoomsPaired),
    totalSignalsRelayed: pick("signals", globalTelemetry.totalSignalsRelayed),
    totalBytesTransferred: pick("bytes", globalTelemetry.totalBytesTransferred),
    totalTransfersCompleted: pick("transfers", globalTelemetry.totalTransfersCompleted),
    totalVisits: pick("visits", globalTelemetry.totalVisits),
    contentStats: {
      files: pick("files", globalTelemetry.contentStats?.files),
      text: pick("texts", globalTelemetry.contentStats?.text),
    },
    deviceStats: {
      desktop: pick("desktop", globalTelemetry.deviceStats?.desktop),
      mobile: pick("mobile", globalTelemetry.deviceStats?.mobile),
      tablet: pick("tablet", globalTelemetry.deviceStats?.tablet),
      other: Number(globalTelemetry.deviceStats?.other) || 0,
    },
  };
}

let globalTelemetry;
try {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(TELEMETRY_FILE)) {
    globalTelemetry = JSON.parse(readFileSync(TELEMETRY_FILE, "utf8"));
  }
} catch {
  // Fall back to generated baseline
}
if (!globalTelemetry || typeof globalTelemetry !== "object") {
  globalTelemetry = generateInitialGlobalState();
}

let saveTimer = null;
function persistGlobalTelemetry() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(TELEMETRY_FILE, JSON.stringify(globalTelemetry, null, 2), "utf8");
    } catch {
      // Ignore disk write errors in read-only environments
    }
  }, 2000);
}

const serverStartedAt = Date.now();

function recordDevice(label) {
  const l = String(label || "").toLowerCase();
  if (l.includes("iphone") || l.includes("android") || l.includes("mobile")) {
    globalTelemetry.deviceStats.mobile++;
    globalHit(GLOBAL_KEYS.mobile);
  } else if (l.includes("ipad") || l.includes("tablet")) {
    globalTelemetry.deviceStats.tablet++;
    globalHit(GLOBAL_KEYS.tablet);
  } else if (l.includes("mac") || l.includes("windows") || l.includes("linux") || l.includes("chrome") || l.includes("firefox") || l.includes("edge")) {
    globalTelemetry.deviceStats.desktop++;
    globalHit(GLOBAL_KEYS.desktop);
  } else {
    globalTelemetry.deviceStats.other++;
  }
  persistGlobalTelemetry();
}

function addTelemetryEvent(event) {
  globalTelemetry.recentEvents.unshift({
    id: randomUUID(),
    title: event.title,
    detail: event.detail,
    route: event.route || "Direct P2P",
    timestamp: Date.now(),
  });
  if (globalTelemetry.recentEvents.length > 25) globalTelemetry.recentEvents.pop();
  persistGlobalTelemetry();
}

function getOrCreateCurrentBucket() {
  const now = Date.now();
  const currentHourStart = new Date(now).setMinutes(0, 0, 0);
  let history = globalTelemetry.hourlyHistory;
  if (!Array.isArray(history) || history.length === 0) {
    globalTelemetry.hourlyHistory = generateInitialGlobalState().hourlyHistory;
    history = globalTelemetry.hourlyHistory;
  }
  let lastBucket = history[history.length - 1];
  if (!lastBucket || lastBucket.timestamp < currentHourStart) {
    const d = new Date(currentHourStart);
    lastBucket = {
      label: `${String(d.getHours()).padStart(2, "0")}:00`,
      timestamp: currentHourStart,
      transfers: 0,
      bytes: 0,
      signals: 0,
      roomsCreated: 0,
      roomsPaired: 0,
    };
    history.push(lastBucket);
    while (history.length > 24) history.shift();
  }
  return lastBucket;
}

function recordBucketActivity({ transfers = 0, bytes = 0, signals = 0, roomsCreated = 0, roomsPaired = 0 }) {
  const bucket = getOrCreateCurrentBucket();
  bucket.transfers += transfers;
  bucket.bytes += bytes;
  bucket.signals += signals;
  bucket.roomsCreated += roomsCreated;
  bucket.roomsPaired += roomsPaired;
  persistGlobalTelemetry();
}

function formatBytes(value) {
  if (!value || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit === 1 ? 0 : 1)} ${["B", "KB", "MB", "GB"][unit]}`;
}

function ipFor(request) {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = request.headers["x-forwarded-for"];
    // Use the last hop added by the trusted reverse proxy, not a spoofable first entry.
    if (typeof forwarded === "string") return forwarded.split(",").at(-1).trim().slice(0, 64);
  }
  return request.socket.remoteAddress || "unknown";
}

function allowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin || typeof origin !== "string") return false;
  try {
    const actual = new URL(origin);
    const explicit = (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (explicit.length) return explicit.includes(actual.origin);

    const host = request.headers.host;
    const protocol = request.headers["x-forwarded-proto"] || (request.socket.encrypted ? "https" : "http");
    if (actual.host === host && actual.protocol === `${protocol}:`) return true;

    // Vite on 5173 talks to the signaling process on 3001 in local development.
    if (process.env.NODE_ENV !== "production") {
      const local = ["localhost", "127.0.0.1", "[::1]"];
      return local.includes(actual.hostname) && local.includes(new URL(`http://${host}`).hostname) && ["5173", "3001"].includes(actual.port);
    }
    return false;
  } catch {
    return false;
  }
}

function iceServers() {
  const stun = (process.env.STUN_URLS || "stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => /^stuns?:[^\s]{1,180}$/i.test(url));
  const result = stun.length ? [{ urls: stun }] : [];
  const turn = (process.env.TURN_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => /^turns?:[^\s]{1,180}$/i.test(url));
  if (turn.length && process.env.TURN_SHARED_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + 60 * 60}:${randomUUID()}`;
    const credential = createHmac("sha1", process.env.TURN_SHARED_SECRET).update(username).digest("base64");
    result.push({ urls: turn, username, credential });
  }
  return result;
}

function send(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function fail(socket, code, message) {
  send(socket, { type: "error", code, message });
}

function closeRoom(room, type = "peer-left", message = "The other device left the room.") {
  if (rooms.get(room.code) !== room) return;
  rooms.delete(room.code);
  addTelemetryEvent({
    title: "Session Room Concluded",
    detail: "Ephemeral room destroyed from volatile memory",
    route: "P2P",
  });
  for (const socket of [room.owner, room.guest]) {
    if (!socket) continue;
    socket.room = null;
    send(socket, { type, message });
  }
}

function rateLimitJoin(ip) {
  const now = Date.now();
  let item = limits.get(ip);
  if (!item || (now > item.resetAt && now > item.blockedUntil)) {
    item = { attempts: 0, resetAt: now + JOIN_WINDOW, blockedUntil: 0 };
  }
  if (now < item.blockedUntil) return Math.ceil((item.blockedUntil - now) / 1000);
  if (now > item.resetAt) {
    item.attempts = 0;
    item.resetAt = now + JOIN_WINDOW;
  }
  item.attempts += 1;
  if (item.attempts > JOIN_LIMIT) item.blockedUntil = now + JOIN_LOCK;
  limits.set(ip, item);
  return item.blockedUntil ? Math.ceil((item.blockedUntil - now) / 1000) : 0;
}

function safeLabel(input) {
  return typeof input === "string" ? input.replace(/[\u0000-\u001f<>]/g, "").slice(0, 48).trim() || "Another browser" : "Another browser";
}

function onMessage(socket, data, isBinary) {
  if (isBinary) return fail(socket, "bad_request", "Binary signaling is not supported.");
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    return fail(socket, "bad_request", "Invalid message.");
  }
  if (!message || typeof message !== "object") return fail(socket, "bad_request", "Invalid message.");

  if (message.type === "create") {
    if (socket.room) return fail(socket, "already_in_room", "Leave the current room first.");
    const owned = [...rooms.values()].filter((room) => room.owner.ip === socket.ip).length;
    if (owned >= MAX_ROOMS_PER_IP) return fail(socket, "room_limit", "Too many open rooms. Close one before starting another.");
    if (rooms.size >= 9000) return fail(socket, "capacity", "Rooms are busy. Please try again shortly.");
    let code;
    do {
      code = String(randomInt(10_000)).padStart(4, "0");
    } while (rooms.has(code));

    const room = {
      code,
      owner: socket,
      guest: null,
      phase: "waiting",
      expiresAt: Date.now() + ROOM_LIFETIME,
      phrase: `${WORDS[randomInt(WORDS.length)]} ${WORDS[randomInt(WORDS.length)]} ${randomInt(10, 100)}`,
    };
    rooms.set(code, room);
    socket.room = room;
    socket.role = "owner";
    socket.label = safeLabel(message.label);
    globalTelemetry.totalRoomsCreated++;
    globalHit(GLOBAL_KEYS.roomsCreated);
    recordDevice(socket.label);
    recordBucketActivity({ roomsCreated: 1 });
    addTelemetryEvent({
      title: "New Session Room Initialized",
      detail: "Ephemeral room awaiting peer join request",
      route: "Signaling",
    });
    send(socket, { type: "created", code, expiresAt: room.expiresAt, iceServers: iceServers() });
    return;
  }

  if (message.type === "join") {
    if (socket.room) return fail(socket, "already_in_room", "Leave the current room first.");
    const retryAfter = rateLimitJoin(socket.ip);
    if (retryAfter) return fail(socket, "rate_limited", `Too many attempts. Try again in ${retryAfter} seconds.`);
    if (typeof message.code !== "string" || !/^\d{4}$/.test(message.code)) {
      return fail(socket, "invalid_code", "Enter exactly four digits.");
    }
    const room = rooms.get(message.code);
    if (!room || room.phase !== "waiting" || Date.now() >= room.expiresAt) {
      return fail(socket, "not_found", "This code is unavailable. Ask the other person for a new code.");
    }
    room.guest = socket;
    room.phase = "pending";
    socket.room = room;
    socket.role = "guest";
    socket.label = safeLabel(message.label);
    recordDevice(socket.label);
    addTelemetryEvent({
      title: "Peer Join Requested",
      detail: "Verification phrase presented for approval",
      route: "Signaling",
    });
    send(socket, { type: "joined", phrase: room.phrase, ownerLabel: room.owner.label, iceServers: iceServers() });
    send(room.owner, { type: "join-request", phrase: room.phrase, guestLabel: socket.label });
    return;
  }

  const room = socket.room;
  if (!room || rooms.get(room.code) !== room) return fail(socket, "no_room", "No active room. Start a new one.");

  if (message.type === "reject") {
    if (socket !== room.owner || room.phase !== "pending") return fail(socket, "bad_request", "No request to decline.");
    send(room.guest, { type: "rejected", message: "The sender declined this connection." });
    room.guest.room = null;
    room.guest = null;
    room.phase = "waiting";
    send(room.owner, { type: "waiting", expiresAt: room.expiresAt });
    return;
  }

  if (message.type === "approve") {
    if (socket !== room.owner || room.phase !== "pending") return fail(socket, "bad_request", "No request to approve.");
    if (Date.now() >= room.expiresAt) return closeRoom(room, "room-expired", "The code expired. Create a new room.");
    room.phase = "paired";
    globalTelemetry.totalRoomsPaired++;
    globalHit(GLOBAL_KEYS.roomsPaired);
    recordBucketActivity({ roomsPaired: 1 });
    addTelemetryEvent({
      title: "P2P WebRTC Channel Approved",
      detail: "Mutual cryptographic channel established",
      route: "Direct P2P",
    });
    send(room.guest, { type: "approved", peerLabel: room.owner.label });
    send(room.owner, { type: "peer-ready", peerLabel: room.guest.label });
    return;
  }

  if (message.type === "signal") {
    if (room.phase !== "paired") return fail(socket, "not_paired", "Approve the connection first.");
    const signal = message.signal;
    const validDescription = signal?.description &&
      ["offer", "answer"].includes(signal.description.type) &&
      typeof signal.description.sdp === "string" && signal.description.sdp.length <= 32_000;
    const validCandidate = signal?.candidate &&
      typeof signal.candidate.candidate === "string" && signal.candidate.candidate.length <= 4_096 &&
      (signal.candidate.sdpMid == null || typeof signal.candidate.sdpMid === "string") &&
      (signal.candidate.sdpMLineIndex == null || Number.isInteger(signal.candidate.sdpMLineIndex));
    if (!validDescription && !validCandidate) return fail(socket, "bad_request", "Invalid connection signal.");
    globalTelemetry.totalSignalsRelayed++;
    globalHit(GLOBAL_KEYS.signals);
    recordBucketActivity({ signals: 1 });
    if (signal?.description) {
      addTelemetryEvent({
        title: "WebRTC SDP Exchanged",
        detail: `${signal.description.type.toUpperCase()} cryptographic handshake relayed`,
        route: "Encrypted WebRTC",
      });
    }
    send(socket === room.owner ? room.guest : room.owner, {
      type: "signal",
      signal: validDescription
        ? { description: { type: signal.description.type, sdp: signal.description.sdp } }
        : { candidate: { candidate: signal.candidate.candidate, sdpMid: signal.candidate.sdpMid, sdpMLineIndex: signal.candidate.sdpMLineIndex } },
    });
    return;
  }

  if (message.type === "leave") {
    closeRoom(room);
    return;
  }
  fail(socket, "bad_request", "Unknown message type.");
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cache-Control", "no-store");

  if (pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/api/config") {
    if (request.method !== "GET") {
      response.writeHead(405);
      response.end();
      return;
    }
    if (!allowedOrigin(request) && request.headers.origin) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (request.headers.origin) {
      response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
      response.setHeader("Vary", "Origin");
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      relayConfigured: Boolean(process.env.TURN_URLS && process.env.TURN_SHARED_SECRET),
      maxFileBytes: MAX_FILE_BYTES,
      maxTextChars: MAX_TEXT_CHARS,
    }));
    return;
  }

  // Simple per-IP rate limiting for telemetry writes (abuse protection).
  const reportBucket = (ip) => {
    const now = Date.now();
    const key = `report:${ip}`;
    let item = limits.get(key);
    if (!item || now > item.resetAt) {
      item = { attempts: 0, resetAt: now + 60_000 };
    }
    item.attempts += 1;
    limits.set(key, item);
    return item.attempts > 60;
  };

  if (pathname === "/api/report-transfer") {
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    if (!allowedOrigin(request) && request.headers.origin) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (request.headers.origin) {
      response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
      response.setHeader("Vary", "Origin");
    }
    if (reportBucket(ipFor(request))) {
      response.writeHead(429);
      response.end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        response.writeHead(413);
        response.end();
      }
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const bytes = Math.max(0, Math.min(MAX_FILE_BYTES, Number(payload.bytes) || 0));
        const type = payload.type === "text" ? "text" : "file";
        const route = payload.route === "relay" ? "TURN Relay" : "Direct P2P";
        globalTelemetry.totalBytesTransferred += bytes;
        globalTelemetry.totalTransfersCompleted++;
        if (type === "text") globalTelemetry.contentStats.text++;
        else globalTelemetry.contentStats.files++;

        // Mirror into durable cross-deployment global counters (all users).
        globalHit(GLOBAL_KEYS.transfers);
        globalHit(type === "text" ? GLOBAL_KEYS.texts : GLOBAL_KEYS.files);
        globalAddBytes(bytes);

        recordBucketActivity({ transfers: 1, bytes });
        addTelemetryEvent({
          title: type === "text" ? "Encrypted Text Payload" : "Direct File Transfer Completed",
          detail: `${formatBytes(bytes)} transferred peer-to-peer`,
          route,
        });
        persistGlobalTelemetry();

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      } catch {
        response.writeHead(400);
        response.end();
      }
    });
    return;
  }

  if (pathname === "/api/report-visit") {
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    if (!allowedOrigin(request) && request.headers.origin) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (request.headers.origin) {
      response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
      response.setHeader("Vary", "Origin");
    }
    if (reportBucket(ipFor(request))) {
      response.writeHead(429);
      response.end();
      return;
    }
    globalTelemetry.totalVisits = (Number(globalTelemetry.totalVisits) || 0) + 1;
    globalHit(GLOBAL_KEYS.visits);
    persistGlobalTelemetry();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/api/stats") {
    if (request.method !== "GET") {
      response.writeHead(405);
      response.end();
      return;
    }
    if (!allowedOrigin(request) && request.headers.origin) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (request.headers.origin) {
      response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
      response.setHeader("Vary", "Origin");
    }

    const activeRoomsCount = rooms.size;
    const activeClientsCount = wss.clients.size;

    // Merge this node's real totals with durable cross-deployment global
    // totals (max per metric avoids double-counting this node's own reports).
    refreshGlobalCacheInBackground();
    const overall = mergedOverallTotals();

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      overallPlatform: true,
      historyScope: "node",
      activeRooms: activeRoomsCount,
      activeClients: activeClientsCount,
      totalRoomsCreated: overall.totalRoomsCreated,
      totalRoomsPaired: overall.totalRoomsPaired,
      totalSignalsRelayed: overall.totalSignalsRelayed,
      totalBytesTransferred: overall.totalBytesTransferred,
      totalTransfersCompleted: overall.totalTransfersCompleted,
      totalVisits: overall.totalVisits,
      contentStats: overall.contentStats,
      deviceStats: overall.deviceStats,
      uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
      serverStartedAt,
      serverTime: Date.now(),
      hourlyHistory: globalTelemetry.hourlyHistory,
      recentEvents: globalTelemetry.recentEvents,
    }));
    return;
  }

  if (pathname === "/vexuli-project.zip") {
    const zipPath = join(ROOT, "dist", "vexuli-project.zip");
    if (existsSync(zipPath)) {
      response.setHeader("Content-Disposition", 'attachment; filename="vexuli-project.zip"');
      response.writeHead(200, { "Content-Type": "application/zip" });
      if (request.method === "HEAD") response.end();
      else createReadStream(zipPath).pipe(response);
      return;
    }
  }

  if (!["GET", "HEAD"].includes(request.method) || (pathname !== "/" && pathname !== "/index.html")) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  if (!existsSync(INDEX)) {
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Vexuli has not been built yet. Run npm run build first.");
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (request.method === "HEAD") response.end();
  else createReadStream(INDEX).pipe(response);
});

server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url || "/", "http://localhost").pathname !== "/signal" || !allowedOrigin(request)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const ip = ipFor(request);
  const sameIp = [...wss.clients].filter((client) => client.ip === ip).length;
  if (wss.clients.size >= 2_000 || sameIp >= 12) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
});

wss.on("connection", (socket, request) => {
  socket.ip = ipFor(request);
  socket.room = null;
  socket.alive = true;
  socket.on("pong", () => { socket.alive = true; });
  socket.on("message", (data, isBinary) => onMessage(socket, data, isBinary));
  socket.on("close", () => {
    if (socket.room) closeRoom(socket.room);
  });
  socket.on("error", () => {});
});

const housekeeping = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase !== "paired" && now >= room.expiresAt) {
      closeRoom(room, "room-expired", "The code expired. Create a new room.");
    }
  }
  for (const [ip, item] of limits) {
    if (now > item.resetAt && now > item.blockedUntil) limits.delete(ip);
  }
}, 5_000);

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.alive) {
      socket.terminate();
      continue;
    }
    socket.alive = false;
    socket.ping();
  }
}, 30_000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Vexuli listening on port ${PORT}`);
  if (!process.env.TURN_URLS || !process.env.TURN_SHARED_SECRET) {
    console.warn("TURN is not configured. Connections across restrictive networks may fail; see README.md.");
  }
  // Pick up durable cross-deployment history so a fresh disk still serves
  // overall past → up-to-date totals (max per metric, never backwards).
  (async () => {
    const totals = await fetchGlobalTotals();
    if (!totals) return;
    let changed = false;
    const takeMax = (obj, key, val) => {
      const next = Math.max(Number(obj[key]) || 0, Number(val) || 0);
      if (next !== obj[key]) {
        obj[key] = next;
        changed = true;
      }
    };
    takeMax(globalTelemetry, "totalRoomsCreated", totals.roomsCreated);
    takeMax(globalTelemetry, "totalRoomsPaired", totals.roomsPaired);
    takeMax(globalTelemetry, "totalSignalsRelayed", totals.signals);
    takeMax(globalTelemetry, "totalBytesTransferred", totals.bytes);
    takeMax(globalTelemetry, "totalTransfersCompleted", totals.transfers);
    takeMax(globalTelemetry, "totalVisits", totals.visits);
    takeMax(globalTelemetry.contentStats, "files", totals.files);
    takeMax(globalTelemetry.contentStats, "text", totals.texts);
    takeMax(globalTelemetry.deviceStats, "desktop", totals.desktop);
    takeMax(globalTelemetry.deviceStats, "mobile", totals.mobile);
    takeMax(globalTelemetry.deviceStats, "tablet", totals.tablet);
    if (changed) persistGlobalTelemetry();
  })();
});

function shutdown() {
  clearInterval(housekeeping);
  clearInterval(heartbeat);
  for (const socket of wss.clients) socket.close(1001, "Server restarting");
  server.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);