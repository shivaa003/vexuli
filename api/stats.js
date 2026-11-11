import { getGlobalStats } from "./_telemetry.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }
  try {
    res.status(200).json(await getGlobalStats());
  } catch {
    res.status(500).json({ ok: false });
  }
}
