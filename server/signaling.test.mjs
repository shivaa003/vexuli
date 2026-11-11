import assert from "node:assert/strict";
import { createHmac, randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";

class Client {
  constructor(socket) {
    this.socket = socket;
    this.queue = [];
    this.waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const index = this.waiters.findIndex((waiter) => waiter.type === message.type);
      if (index === -1) {
        this.queue.push(message);
      } else {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  next(type) {
    const index = this.queue.findIndex((message) => message.type === type);
    if (index !== -1) return Promise.resolve(this.queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { type, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error(`Timed out waiting for ${type}. Queued: ${JSON.stringify(this.queue)}`));
      }, 3500);
      this.waiters.push(waiter);
    });
  }

  close() {
    this.socket.close();
  }
}

test("real signaling: unique room codes, approval, privacy boundary and cleanup", async (t) => {
  const port = randomInt(32_000, 48_000);
  const origin = `http://127.0.0.1:${port}`;
  const secret = "this-is-a-unique-test-turn-shared-secret";
  const processServer = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
      TRUST_PROXY: "1",
      TURN_URLS: "turn:turn.example.test:3478?transport=udp",
      TURN_SHARED_SECRET: secret,
      DISABLE_GLOBAL_SYNC: "1",
      TELEMETRY_FILE: join(tmpdir(), `vexuli-test-telemetry-${port}.json`),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  processServer.stdout.on("data", (data) => { logs += data.toString(); });
  processServer.stderr.on("data", (data) => { logs += data.toString(); });
  const clients = [];
  t.after(() => {
    clients.forEach((client) => client.close());
    processServer.kill("SIGTERM");
  });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.ok(ready, `The server did not start. ${logs}`);

  const config = await fetch(`${origin}/api/config`, { headers: { Origin: origin } }).then((r) => r.json());
  assert.equal(config.relayConfigured, true);
  assert.equal(config.maxFileBytes, 100 * 1024 * 1024);
  assert.ok(!JSON.stringify(config).includes(secret), "TURN secrets must not be public");
  const html = await fetch(origin).then((r) => r.text());
  assert.match(html, /Vexuli/);

  const connect = async (ip = "198.51.100.10") => {
    const socket = new WebSocket(`${origin.replace("http:", "ws:")}/signal`, {
      headers: { Origin: origin, "X-Forwarded-For": ip },
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const client = new Client(socket);
    clients.push(client);
    return client;
  };

  const owner = await connect();
  const otherOwner = await connect();
  owner.send({ type: "create", label: "Firefox on Linux" });
  otherOwner.send({ type: "create", label: "Chrome on Mac" });
  const first = await owner.next("created");
  const second = await otherOwner.next("created");
  assert.match(first.code, /^\d{4}$/);
  assert.notEqual(first.code, second.code, "active room codes must be unique");
  assert.ok(first.expiresAt > Date.now());
  const turn = first.iceServers.find((server) => server.username);
  assert.ok(turn, "room participants should receive TURN credentials");
  assert.equal(createHmac("sha1", secret).update(turn.username).digest("base64"), turn.credential);

  const guest = await connect();
  guest.send({ type: "join", code: first.code, label: "Safari on iPhone" });
  const joined = await guest.next("joined");
  const request = await owner.next("join-request");
  assert.equal(joined.phrase, request.phrase);
  assert.equal(request.guestLabel, "Safari on iPhone");

  guest.send({ type: "signal", signal: { description: { type: "offer", sdp: "v=0" } } });
  assert.equal((await guest.next("error")).code, "not_paired", "signaling before approval must be blocked");

  owner.send({ type: "approve" });
  await guest.next("approved");
  await owner.next("peer-ready");
  owner.send({ type: "signal", signal: { description: { type: "offer", sdp: "v=0" } } });
  assert.equal((await guest.next("signal")).signal.description.sdp, "v=0");
  guest.socket.send(Buffer.from("file bytes must not travel over signaling"));
  assert.equal((await guest.next("error")).code, "bad_request", "binary file frames must be rejected by signaling");

  const late = await connect();
  late.send({ type: "join", code: first.code });
  assert.equal((await late.next("error")).code, "not_found", "paired codes cannot be reused");
  guest.send({ type: "leave" });
  await owner.next("peer-left");
  await guest.next("peer-left");

  const attacker = await connect("198.51.100.11");
  for (let i = 0; i < 5; i++) {
    attacker.send({ type: "join", code: "invalid" });
    assert.equal((await attacker.next("error")).code, "invalid_code");
  }
  attacker.send({ type: "join", code: "invalid" });
  assert.equal((await attacker.next("error")).code, "rate_limited", "guessing must be throttled");

  await new Promise((resolve) => {
    const unauthorized = new WebSocket(`${origin.replace("http:", "ws:")}/signal`, {
      headers: { Origin: "https://untrusted.example" },
    });
    unauthorized.on("error", (error) => {
      assert.match(error.message, /403/);
      resolve();
    });
  });

  // Real overall analytics: totals must reflect the rooms/signals above,
  // with no mock wave data and no room codes leaked in telemetry.
  const stats = await fetch(`${origin}/api/stats`, { headers: { Origin: origin } }).then((r) => r.json());
  assert.equal(stats.overallPlatform, true);
  assert.ok(stats.totalRoomsCreated >= 2, "created rooms must be counted");
  assert.ok(stats.totalRoomsPaired >= 1, "paired rooms must be counted");
  assert.ok(stats.totalSignalsRelayed >= 1, "relayed signals must be counted");
  assert.ok(Array.isArray(stats.hourlyHistory) && stats.hourlyHistory.length > 0);
  const historyTotals = stats.hourlyHistory.reduce((acc, b) => acc + (b.transfers || 0) + (b.signals || 0) + (b.roomsCreated || 0), 0);
  assert.ok(historyTotals < 100, `hourly history must be real (small), got ${historyTotals}`);
  const readableText = (stats.recentEvents || [])
    .map((e) => `${e.title || ""} ${e.detail || ""} ${e.route || ""}`)
    .join(" | ");
  assert.equal(/\b\d{4}\b/.test(readableText), false, "telemetry must never leak room codes");
  assert.equal(/code\s*#/i.test(readableText), false, "telemetry must never reference codes");

  // Visit reporting must increment the overall visit counter.
  await fetch(`${origin}/api/report-visit`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const statsAfterVisit = await fetch(`${origin}/api/stats`, { headers: { Origin: origin } }).then((r) => r.json());
  assert.ok(statsAfterVisit.totalVisits >= 1, "visits must be counted");
});