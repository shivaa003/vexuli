/**
 * Durable global analytics shared by every deployment and every user.
 *
 * The Node signaling server (Render/self-host) persists totals to disk, but
 * serverless deployments (Vercel) have ephemeral per-instance memory. To keep
 * one honest "past → up-to-date" overall count across ALL users, cumulative
 * totals are mirrored into free, no-auth, CORS-enabled public counters.
 *
 * Privacy: only aggregate numbers are stored (counts + byte sums).
 * Never room codes, filenames, file bytes, IPs, or message content.
 */

const COUNTER_BASE = "https://countapi.mileshilliard.com/api/v1";
const PREFIX = "vexuli-prod-v1-";

export const GLOBAL_KEYS = {
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
} as const;

export type GlobalTotals = {
  roomsCreated: number;
  roomsPaired: number;
  transfers: number;
  files: number;
  texts: number;
  bytes: number;
  signals: number;
  desktop: number;
  mobile: number;
  tablet: number;
  visits: number;
};

export const ZERO_GLOBAL_TOTALS: GlobalTotals = {
  roomsCreated: 0,
  roomsPaired: 0,
  transfers: 0,
  files: 0,
  texts: 0,
  bytes: 0,
  signals: 0,
  desktop: 0,
  mobile: 0,
  tablet: 0,
  visits: 0,
};

const CACHE_KEY = "vexuli-global-cache-v1";
const VISIT_FLAG = "vexuli-visit-reported-v1";

function isLocalHost(): boolean {
  try {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "";
  } catch {
    return true;
  }
}

function isProdBrowser(): boolean {
  try {
    return Boolean(import.meta.env.PROD) && !isLocalHost();
  } catch {
    return false;
  }
}

function serverOrigin(): string {
  try {
    const override = import.meta.env.VITE_APP_SERVER_ORIGIN as string | undefined;
    if (override) return override.replace(/\/$/, "");
  } catch {
    /* ignore */
  }
  return window.location.origin;
}

async function fetchJson(url: string, timeoutMs: number, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function num(value: unknown): number {
  const n = typeof value === "object" && value !== null && "value" in value
    ? Number((value as { value: unknown }).value)
    : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

async function globalGet(key: string): Promise<number> {
  try {
    const data = await fetchJson(`${COUNTER_BASE}/get/${encodeURIComponent(key)}`, 3500);
    return num(data);
  } catch {
    return 0;
  }
}

/** Read-only: safe anywhere (GET never mutates). Falls back to cache on failure. */
export async function fetchGlobalTotals(): Promise<GlobalTotals> {
  try {
    const entries = Object.entries(GLOBAL_KEYS) as Array<[keyof GlobalTotals, string]>;
    const values = await Promise.all(entries.map(([, key]) => globalGet(key)));
    const totals = { ...ZERO_GLOBAL_TOTALS };
    entries.forEach(([field], i) => {
      totals[field] = values[i] || 0;
    });
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ totals, at: Date.now() }));
    } catch {
      /* storage unavailable */
    }
    return totals;
  } catch {
    return readCachedGlobalTotals() || { ...ZERO_GLOBAL_TOTALS };
  }
}

export function readCachedGlobalTotals(): GlobalTotals | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { totals?: GlobalTotals };
    if (!parsed || typeof parsed.totals !== "object") return null;
    return { ...ZERO_GLOBAL_TOTALS, ...parsed.totals };
  } catch {
    return null;
  }
}

async function directHit(key: string): Promise<void> {
  try {
    await fetchJson(`${COUNTER_BASE}/hit/${encodeURIComponent(key)}`, 3500);
  } catch {
    /* best effort */
  }
}

/**
 * Report one site visit per browser session.
 * Prefers the same-origin backend (which forwards to global counters);
 * falls back to a direct global hit only in real production browsers.
 */
export async function reportVisitOnce(): Promise<void> {
  try {
    if (sessionStorage.getItem(VISIT_FLAG) === "1") return;
    sessionStorage.setItem(VISIT_FLAG, "1");
  } catch {
    return;
  }

  // Primary path: backend records + forwards (works for Node + Vercel runtimes).
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(`${serverOrigin()}/api/report-visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ua: navigator.userAgent.slice(0, 120) }),
        signal: controller.signal,
      });
      if (res.ok) return;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* fall through to direct */
  }

  // Fallback path: direct global hit (production browsers only, never tests/dev).
  if (isProdBrowser()) {
    await directHit(GLOBAL_KEYS.visits);
  }
}
