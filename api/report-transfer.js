import { recordTransfer } from "./_telemetry.js";

const buckets = new Map();

function limited(ip) {
  const now = Date.now();
  let item = buckets.get(ip);
  if (!item || now > item.resetAt) {
    item = { attempts: 0, resetAt: now + 60_000 };
  }
  item.attempts += 1;
  buckets.set(ip, item);
  return item.attempts > 60;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method === "POST") {
    try {
      const forwarded = req.headers["x-forwarded-for"];
      const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "unknown";
      if (limited(ip)) {
        res.status(429).json({ ok: false });
        return;
      }
      const { bytes, type, route } = req.body || {};
      await recordTransfer({ bytes: Number(bytes) || 0, type, route });
      res.status(200).json({ ok: true });
    } catch {
      res.status(400).json({ ok: false });
    }
    return;
  }
  res.status(405).end();
}
