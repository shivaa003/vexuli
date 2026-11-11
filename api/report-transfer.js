import { recordTransfer } from "./_telemetry.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method === "POST") {
    try {
      const { bytes, type, route } = req.body || {};
      recordTransfer({ bytes: Number(bytes) || 0, type, route });
      res.status(200).json({ ok: true });
    } catch {
      res.status(400).json({ ok: false });
    }
    return;
  }
  res.status(405).end();
}
