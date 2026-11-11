import { createHmac, randomInt, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
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

let totalRoomsCreated = 0;
let totalRoomsPaired = 0;
let totalSignalsRelayed = 0;
let totalBytesTransferred = 0;
let totalTransfersCompleted = 0;
const serverStartedAt = Date.now();

const contentStats = { files: 0, text: 0 };
const deviceStats = { desktop: 0, mobile: 0, tablet: 0, other: 0 };

function recordDevice(label) {
  const l = String(label || "").toLowerCase();
  if (l.includes("iphone") || l.includes("android") || l.includes("mobile")) {
    deviceStats.mobile++;
  } else if (l.includes("ipad") || l.includes("tablet")) {
    deviceStats.tablet++;
  } else if (l.includes("mac") || l.includes("windows") || l.includes("linux") || l.includes("chrome") || l.includes("firefox") || l.includes("edge")) {
    deviceStats.desktop++;
  } else {
    deviceStats.other++;
  }
}

const recentEvents = [
  {
    id: randomUUID(),
    title: "Vexuli Node Active",
    detail: "Zero-knowledge WebRTC signaling online",
    route: "Signaling",
    timestamp: serverStartedAt,
  },
];

function addTelemetryEvent(event) {
  recentEvents.unshift({
    id: randomUUID(),
    title: event.title,
    detail: event.detail,
    route: event.route || "Direct P2P",
    timestamp: Date.now(),
  });
  if (recentEvents.length > 25) recentEvents.pop();
}

const hourlyHistory = [];
const initHour = new Date();
initHour.setMinutes(0, 0, 0, 0);
for (let i = 23; i >= 0; i--) {
  const d = new Date(initHour.getTime() - i * 60 * 60 * 1000);
  hourlyHistory.push({
    label: `${String(d.getHours()).padStart(2, "0")}:00`,
    timestamp: d.getTime(),
    transfers: 0,
    bytes: 0,
    signals: 0,
    roomsCreated: 0,
    roomsPaired: 0,
  });
}

function getOrCreateCurrentBucket() {
  const now = Date.now();
  const currentHourStart = new Date(now).setMinutes(0, 0, 0, 0);
  let lastBucket = hourlyHistory[hourlyHistory.length - 1];
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
    hourlyHistory.push(lastBucket);
    while (hourlyHistory.length > 24) hourlyHistory.shift();
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
}

function formatBytes(value) {
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
    totalRoomsCreated++;
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
    totalRoomsPaired++;
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
    totalSignalsRelayed++;
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
        totalBytesTransferred += bytes;
        totalTransfersCompleted++;
        if (type === "text") contentStats.text++;
        else contentStats.files++;

        recordBucketActivity({ transfers: 1, bytes });
        addTelemetryEvent({
          title: type === "text" ? "Encrypted Text Payload" : "Direct File Transfer Completed",
          detail: `${formatBytes(bytes)} transferred peer-to-peer`,
          route,
        });

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      } catch {
        response.writeHead(400);
        response.end();
      }
    });
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
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      activeRooms: rooms.size,
      activeClients: wss.clients.size,
      totalRoomsCreated,
      totalRoomsPaired,
      totalSignalsRelayed,
      totalBytesTransferred,
      totalTransfersCompleted,
      contentStats,
      deviceStats,
      uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
      serverStartedAt,
      serverTime: Date.now(),
      hourlyHistory,
      recentEvents,
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
});

function shutdown() {
  clearInterval(housekeeping);
  clearInterval(heartbeat);
  for (const socket of wss.clients) socket.close(1001, "Server restarting");
  server.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);