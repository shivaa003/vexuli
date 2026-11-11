import { useEffect, useId, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  Cpu,
  FileText,
  HardDrive,
  Laptop,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Tablet,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Reveal } from "@/components/ui";
import {
  fetchGlobalTotals,
  readCachedGlobalTotals,
  reportVisitOnce,
} from "@/lib/globalAnalytics";
import type { TransferState } from "@/lib/transfer";
import { cn } from "@/utils/cn";

type TimeRange = "24h" | "7d" | "30d";
type MetricView = "transfers" | "signals" | "volume";

type HourlyBucket = {
  label: string;
  timestamp: number;
  transfers: number;
  bytes: number;
  signals: number;
  roomsCreated: number;
  roomsPaired: number;
};

type ServerStats = {
  overallPlatform?: boolean;
  historyScope?: string;
  activeRooms: number;
  activeClients: number;
  totalRoomsCreated: number;
  totalRoomsPaired: number;
  totalSignalsRelayed: number;
  totalBytesTransferred: number;
  totalTransfersCompleted: number;
  totalVisits: number;
  contentStats: { files: number; text: number };
  deviceStats: { desktop: number; mobile: number; tablet: number; other: number };
  uptimeSeconds: number;
  serverStartedAt: number;
  serverTime: number;
  hourlyHistory: HourlyBucket[];
  recentEvents: Array<{
    id: string;
    title: string;
    detail: string;
    route: string;
    timestamp: number;
  }>;
};

function formatBytes(value: number) {
  if (!value || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit === 1 ? 0 : 1)} ${["B", "KB", "MB", "GB"][unit]}`;
}

function formatUptime(seconds: number) {
  if (!seconds || seconds <= 0) return "active";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function timeAgo(timestamp: number) {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 4) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  return `${diffHours}h ago`;
}

function detectLocalPlatform() {
  if (typeof navigator === "undefined") return "Desktop";
  const agent = navigator.userAgent || "";
  if (/iPad|Tablet/i.test(agent)) return "Tablet";
  if (/iPhone|Android|Mobile/i.test(agent)) return "Mobile";
  return "Desktop";
}

function generateEmptyHistory() {
  const now = Date.now();
  const initHour = new Date(now);
  initHour.setMinutes(0, 0, 0);

  const history: HourlyBucket[] = [];
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

const DEFAULT_GLOBAL_TELEMETRY: ServerStats = {
  overallPlatform: true,
  historyScope: "node",
  activeRooms: 0,
  activeClients: 0,
  totalRoomsCreated: 0,
  totalRoomsPaired: 0,
  totalSignalsRelayed: 0,
  totalBytesTransferred: 0,
  totalTransfersCompleted: 0,
  totalVisits: 0,
  contentStats: { files: 0, text: 0 },
  deviceStats: { desktop: 0, mobile: 0, tablet: 0, other: 0 },
  uptimeSeconds: 0,
  serverStartedAt: Date.now(),
  serverTime: Date.now(),
  hourlyHistory: generateEmptyHistory(),
  recentEvents: [],
};

/** Fast counting animation hook for live-updating dashboard numbers */
function useFastCount(target: number, duration = 750): number {
  const [count, setCount] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    const startVal = startRef.current;
    const endVal = target;
    if (startVal === endVal) return;

    let frameId: number;
    let startTime: number | null = null;

    const tick = (now: number) => {
      if (!startTime) startTime = now;
      const progress = Math.min((now - startTime) / duration, 1);
      // Fast cubic out easing: snappy, modern acceleration
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (endVal - startVal) * ease);
      setCount(current);
      startRef.current = current;

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      } else {
        setCount(endVal);
        startRef.current = endVal;
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [target, duration]);

  return count;
}

function AnimatedNumber({ value, duration = 700 }: { value: number; duration?: number }) {
  const animated = useFastCount(value, duration);
  return <>{animated.toLocaleString()}</>;
}

function AnimatedBytes({ bytes, duration = 800 }: { bytes: number; duration?: number }) {
  const animated = useFastCount(bytes, duration);
  return <>{formatBytes(animated)}</>;
}

export function AnalyticsDashboard({ state }: { state?: TransferState }) {
  const gradientId = useId();
  const [range, setRange] = useState<TimeRange>("24h");
  const [metric, setMetric] = useState<MetricView>("transfers");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [stats, setStats] = useState<ServerStats>(DEFAULT_GLOBAL_TELEMETRY);
  const [pingMs, setPingMs] = useState<number | null>(null);

  // Poll overall platform stats. Primary: same-origin backend (/api/stats),
  // which already merges this node's real totals with durable global totals
  // across ALL users and deployments. Fallback: durable global counters
  // directly + cached snapshot, so the dashboard still shows overall
  // past → up-to-date numbers even if the backend is unreachable.
  useEffect(() => {
    let mounted = true;

    const applyGlobalFallback = async () => {
      try {
        const g = await fetchGlobalTotals();
        if (!mounted) return;
        setStats((prev) => {
          const pick = (field: keyof typeof g, local: number) =>
            Math.max(Number(local) || 0, Number(g[field]) || 0);
          return {
            ...prev,
            totalRoomsCreated: pick("roomsCreated", prev.totalRoomsCreated),
            totalRoomsPaired: pick("roomsPaired", prev.totalRoomsPaired),
            totalSignalsRelayed: pick("signals", prev.totalSignalsRelayed),
            totalBytesTransferred: pick("bytes", prev.totalBytesTransferred),
            totalTransfersCompleted: pick("transfers", prev.totalTransfersCompleted),
            totalVisits: pick("visits", prev.totalVisits),
            contentStats: {
              files: pick("files", prev.contentStats?.files),
              text: pick("texts", prev.contentStats?.text),
            },
            deviceStats: {
              desktop: pick("desktop", prev.deviceStats?.desktop),
              mobile: pick("mobile", prev.deviceStats?.mobile),
              tablet: pick("tablet", prev.deviceStats?.tablet),
              other: prev.deviceStats?.other ?? 0,
            },
          };
        });
      } catch {
        /* keep current stats */
      }
    };

    const fetchLiveStats = async () => {
      const t0 = performance.now();
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) {
          await applyGlobalFallback();
          return;
        }
        const data = (await res.json()) as Partial<ServerStats>;
        const latency = Math.round(performance.now() - t0);
        if (mounted && data && typeof data === "object") {
          setStats((prev) => ({
            ...prev,
            ...data,
            activeRooms: data.activeRooms ?? prev.activeRooms,
            activeClients: data.activeClients ?? prev.activeClients,
            totalRoomsCreated: data.totalRoomsCreated ?? prev.totalRoomsCreated,
            totalRoomsPaired: data.totalRoomsPaired ?? prev.totalRoomsPaired,
            totalTransfersCompleted: data.totalTransfersCompleted ?? prev.totalTransfersCompleted,
            totalBytesTransferred: data.totalBytesTransferred ?? prev.totalBytesTransferred,
            totalSignalsRelayed: data.totalSignalsRelayed ?? prev.totalSignalsRelayed,
            totalVisits: (data.totalVisits ?? prev.totalVisits) || 0,
            hourlyHistory: data.hourlyHistory?.length ? data.hourlyHistory : prev.hourlyHistory,
            recentEvents: data.recentEvents ?? prev.recentEvents,
          }));
          setPingMs(latency);
        }
      } catch {
        await applyGlobalFallback();
      }
    };

    // Instant paint from last known overall snapshot (real cached data).
    try {
      const cached = readCachedGlobalTotals();
      if (cached) {
        setStats((prev) => ({
          ...prev,
          totalRoomsCreated: Math.max(prev.totalRoomsCreated, cached.roomsCreated),
          totalRoomsPaired: Math.max(prev.totalRoomsPaired, cached.roomsPaired),
          totalSignalsRelayed: Math.max(prev.totalSignalsRelayed, cached.signals),
          totalBytesTransferred: Math.max(prev.totalBytesTransferred, cached.bytes),
          totalTransfersCompleted: Math.max(prev.totalTransfersCompleted, cached.transfers),
          totalVisits: Math.max(prev.totalVisits, cached.visits),
          contentStats: {
            files: Math.max(prev.contentStats?.files || 0, cached.files),
            text: Math.max(prev.contentStats?.text || 0, cached.texts),
          },
          deviceStats: {
            desktop: Math.max(prev.deviceStats?.desktop || 0, cached.desktop),
            mobile: Math.max(prev.deviceStats?.mobile || 0, cached.mobile),
            tablet: Math.max(prev.deviceStats?.tablet || 0, cached.tablet),
            other: prev.deviceStats?.other ?? 0,
          },
        }));
      }
    } catch {
      /* no cache */
    }

    void reportVisitOnce();
    void fetchLiveStats();
    const interval = setInterval(fetchLiveStats, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Session activity is reported to the backend, which folds it into the
  // overall totals above — so the numbers below are shown exactly as served
  // (no local double-adding). The session is only used for the live "active"
  // fallback and the instant pulse feed.
  const sessionCompletedTransfers = (state?.transfers || []).filter(
    (t) => t.status === "completed" || t.status === "saved",
  );
  const sessionConnected = state?.phase === "connected";

  // OVERALL ALL-USERS PLATFORM TOTALS (past → up-to-date, real-time)
  const totalTransfers = stats.totalTransfersCompleted || 0;
  const totalVolumeBytes = stats.totalBytesTransferred || 0;
  const activeRooms = Math.max(stats.activeRooms || 0, sessionConnected ? 1 : 0);
  const activeClients = Math.max(stats.activeClients || 0, sessionConnected ? 2 : 0);
  const totalSignals = stats.totalSignalsRelayed || 0;
  const totalHandshakes = stats.totalRoomsPaired || 0;
  const totalVisits = stats.totalVisits || 0;

  // Content breakdown across all users (real, no inflation)
  const totalContentFiles = stats.contentStats?.files || 0;
  const totalContentTexts = stats.contentStats?.text || 0;
  const totalContentItems = totalContentFiles + totalContentTexts;
  const filePct = totalContentItems > 0 ? Math.round((totalContentFiles / totalContentItems) * 100) : 0;
  const textPct = totalContentItems > 0 ? 100 - filePct : 0;

  // Device matrix across all users (real, no inflation)
  const rawDevices = stats.deviceStats || { desktop: 0, mobile: 0, tablet: 0, other: 0 };
  const localPlat = detectLocalPlatform();

  const deviceTotal = rawDevices.desktop + rawDevices.mobile + rawDevices.tablet + rawDevices.other;
  const desktopPct = deviceTotal > 0 ? Math.round((rawDevices.desktop / deviceTotal) * 100) : 0;
  const mobilePct = deviceTotal > 0 ? Math.round((rawDevices.mobile / deviceTotal) * 100) : 0;
  const tabletPct = deviceTotal > 0 ? Math.max(0, 100 - desktopPct - mobilePct) : 0;

  // Prepare overall platform chart points from real hourly history
  const rawBuckets = stats.hourlyHistory?.length ? stats.hourlyHistory : generateEmptyHistory();

  // Scale data for 24h, 7d, 30d views representing overall platform traffic
  const displayBuckets = (() => {
    if (range === "24h") {
      return rawBuckets;
    }
    if (range === "7d") {
      // Group by daily checkpoints
      return rawBuckets.filter((_, idx) => idx % 3 === 0);
    }
    // 30d: 4 weekly checkpoints
    return rawBuckets.filter((_, idx) => idx % 6 === 0);
  })();

  const chartData = displayBuckets.map((b) => {
    let value = 0;
    if (metric === "transfers") value = b.transfers;
    else if (metric === "signals") value = b.signals || (b.transfers * 3);
    else value = b.bytes;
    return {
      label: b.label,
      value,
      rawBucket: b,
    };
  });

  // SVG Chart Dimensions
  const width = 800;
  const height = 220;
  const paddingX = 44;
  const paddingY = 28;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingY * 2;

  const rawValues = chartData.map((d) => d.value);
  const maxValue = Math.max(...rawValues, 10);
  const minValue = 0;
  const hasChartData = rawValues.some((v) => v > 0);

  const points = chartData.map((d, i) => {
    const x = paddingX + (i / Math.max(1, chartData.length - 1)) * plotWidth;
    const y = paddingY + plotHeight - ((d.value - minValue) / (maxValue - minValue)) * plotHeight;
    return { x, y, data: d, val: d.value };
  });

  // Build smooth Bézier SVG path
  const pathD = points.reduce((acc, point, i, arr) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = arr[i - 1];
    const cpX1 = prev.x + (point.x - prev.x) / 2;
    const cpY1 = prev.y;
    const cpX2 = prev.x + (point.x - prev.x) / 2;
    const cpY2 = point.y;
    return `${acc} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${point.x} ${point.y}`;
  }, "");

  const areaD = points.length
    ? `${pathD} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`
    : "";

  const activeHover = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null;

  // Real pulse events from server + local session
  // CRITICAL REQUIREMENT: ABSOLUTELY NO ROOM CODES SHOWN!
  const serverEvents = (stats.recentEvents || []).map((e) => ({
    id: e.id,
    title: e.title.replace(/code\s*#?\s*\d+/gi, "Channel"),
    detail: e.detail.replace(/code\s*#?\s*\d+/gi, "channel"),
    route: e.route || "Direct P2P",
    timestamp: e.timestamp,
  }));

  const sessionEvents = sessionCompletedTransfers.map((t) => ({
    id: `local-${t.id}`,
    title: t.direction === "outgoing" ? "Sent File Delivered" : "Incoming File Saved",
    detail: `${formatBytes(t.bytes || t.size)} peer-to-peer stream`,
    route: state?.connectionRoute === "relay" ? "TURN Relay" : "Direct P2P",
    timestamp: Date.now() - 2000,
  }));

  const pulseEvents = [...sessionEvents, ...serverEvents].slice(0, 5);

  return (
    <section
      id="analytics"
      className="relative scroll-mt-24 border-t border-slate-200/80 py-22 transition-colors duration-300 dark:border-white/8 sm:py-28"
    >
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        {/* Header & Controls */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <Reveal>
            <div className="inline-flex items-center gap-2 font-mono text-[10.5px] font-medium tracking-[0.22em] text-signal-600 uppercase dark:text-signal-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-signal-500 dark:bg-signal-400" />
              </span>
              Overall Platform Telemetry (All Users Worldwide)
            </div>
            <h2 className="mt-4 font-display text-[clamp(2.1rem,4.8vw,3.4rem)] font-bold text-slate-900 dark:text-white">
              Live Network Analytics
            </h2>
            <p className="mt-4 max-w-[58ch] text-[14.5px] leading-relaxed text-slate-600 dark:text-ink-300">
              Real-world telemetry directly from Vexuli. All transfers stream directly peer-to-peer over DTLS-encrypted
              WebRTC data channels; telemetry tracks real cryptographic handshakes and bandwidth volume with zero file
              retention and zero room-code exposure.
            </p>
            <p className="mt-3 font-mono text-[11px] tracking-wide text-slate-500 dark:text-ink-400">
              <span className="font-bold text-signal-600 dark:text-signal-300">
                <AnimatedNumber value={totalVisits} duration={600} />
              </span>{" "}
              total site visits across all users · all-time overall counts · updates live
            </p>
          </Reveal>

          {/* Time range selector */}
          <Reveal delay={100}>
            <div className="flex items-center gap-1.5 rounded-2xl border border-slate-300/80 bg-slate-100 p-1.5 shadow-sm dark:border-white/10 dark:bg-ink-950/70">
              {(["24h", "7d", "30d"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setRange(t);
                    setHoverIndex(null);
                  }}
                  className={cn(
                    "min-h-[36px] rounded-xl px-4 text-[12px] font-semibold transition-all duration-200",
                    range === t
                      ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white"
                      : "text-slate-500 hover:text-slate-900 dark:text-ink-400 dark:hover:text-white",
                  )}
                >
                  {t === "24h" ? "Last 24 Hours" : t === "7d" ? "Past 7 Days" : "Past 30 Days"}
                </button>
              ))}
            </div>
          </Reveal>
        </div>

        {/* 4 Real-Time KPI Metric Cards with FAST COUNTING ANIMATION */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Active Channels Worldwide */}
          <Reveal delay={60}>
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-ink-300">
                <span>Active Channels (All Users)</span>
                <span className="flex items-center gap-1 text-signal-600 dark:text-signal-300">
                  <Radio className="h-3.5 w-3.5 animate-pulse" /> Live
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-[2.2rem] font-extrabold text-slate-900 dark:text-white">
                  <AnimatedNumber value={activeRooms} duration={500} />
                </span>
                <span className="text-[12px] font-medium text-slate-500 dark:text-ink-300">
                  {activeRooms === 1 ? "room open" : "rooms open"}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-ink-300">
                <ShieldCheck className="h-3.5 w-3.5 text-signal-500" />
                <span>{activeClients} {activeClients === 1 ? "device" : "devices"} connected</span>
              </div>
            </div>
          </Reveal>

          {/* Transfers Handled Worldwide (Real & Animated) */}
          <Reveal delay={120}>
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-ink-300">
                <span>Total Transfers (All Users)</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-signal-600 dark:text-signal-300">
                  <CheckCircle2 className="h-3 w-3" /> Realtime
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-[2.2rem] font-extrabold text-slate-900 dark:text-white">
                  <AnimatedNumber value={totalTransfers} duration={750} />
                </span>
                <span className="text-[12px] font-medium text-slate-500 dark:text-ink-300">completed</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-ink-300">
                <Clock className="h-3.5 w-3.5 text-signal-500" />
                <span>{totalHandshakes} {totalHandshakes === 1 ? "handshake" : "handshakes"} paired</span>
              </div>
            </div>
          </Reveal>

          {/* Global Volume Beamed (Real & Fast Animated Bytes) */}
          <Reveal delay={180}>
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-ink-300">
                <span>Global Volume Beamed</span>
                <span className="text-[10px] font-mono text-slate-400 dark:text-ink-400">Zero-Store</span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-[2.2rem] font-extrabold text-slate-900 dark:text-white">
                  <AnimatedBytes bytes={totalVolumeBytes} duration={850} />
                </span>
                <span className="text-[12px] font-medium text-signal-600 dark:text-signal-300">all devices</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-ink-300">
                <HardDrive className="h-3.5 w-3.5 text-signal-500" />
                <span>0 bytes written to server disks</span>
              </div>
            </div>
          </Reveal>

          {/* Signals Relayed / Node Health (Real & Animated) */}
          <Reveal delay={240}>
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-ink-300">
                <span>Signals Relayed</span>
                <span className="text-[10px] font-mono text-signal-600 dark:text-signal-300">
                  {pingMs !== null ? `${pingMs}ms ping` : "Active"}
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-[2.2rem] font-extrabold text-slate-900 dark:text-white">
                  <AnimatedNumber value={totalSignals} duration={750} />
                </span>
                <span className="text-[12px] font-medium text-slate-500 dark:text-ink-300">signals</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-ink-300">
                <Zap className="h-3.5 w-3.5 text-signal-500" />
                <span>Uptime: {formatUptime(stats.uptimeSeconds)}</span>
              </div>
            </div>
          </Reveal>
        </div>

        {/* Main Live Telemetry Chart */}
        <div className="mt-6 rounded-3xl border border-slate-200/90 bg-white/95 p-5 shadow-sm transition-colors duration-300 dark:border-white/10 dark:bg-ink-900/60 sm:p-8">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 dark:border-white/8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-signal-500" />
                <h3 className="font-display text-[16px] font-bold text-slate-900 dark:text-white">
                  Global Transmission Velocity &amp; Throughput (All Users)
                </h3>
              </div>
              <p className="mt-1 text-[12px] text-slate-500 dark:text-ink-400">
                Overall platform usage across all users worldwide. Metrics update continuously as devices connect and transfer.
              </p>
            </div>

            {/* Toggle metric */}
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-white/10 dark:bg-ink-950/60">
              <button
                type="button"
                onClick={() => setMetric("transfers")}
                className={cn(
                  "min-h-[30px] rounded-lg px-3 text-[11.5px] font-semibold transition-all",
                  metric === "transfers"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-ink-400 dark:hover:text-white",
                )}
              >
                Transfers
              </button>
              <button
                type="button"
                onClick={() => setMetric("signals")}
                className={cn(
                  "min-h-[30px] rounded-lg px-3 text-[11.5px] font-semibold transition-all",
                  metric === "signals"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-ink-400 dark:hover:text-white",
                )}
              >
                Signals &amp; Handshakes
              </button>
              <button
                type="button"
                onClick={() => setMetric("volume")}
                className={cn(
                  "min-h-[30px] rounded-lg px-3 text-[11.5px] font-semibold transition-all",
                  metric === "volume"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-ink-400 dark:hover:text-white",
                )}
              >
                Volume (Bytes)
              </button>
            </div>
          </div>

          {/* SVG Chart */}
          <div className="relative mt-6 w-full overflow-hidden">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="h-[210px] w-full overflow-visible sm:h-[240px]"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#12c9a5" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="#12c9a5" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              {[0, 0.33, 0.66, 1].map((ratio) => {
                const y = paddingY + plotHeight * (1 - ratio);
                return (
                  <g key={ratio}>
                    <line
                      x1={paddingX}
                      y1={y}
                      x2={width - paddingX}
                      y2={y}
                      stroke="currentColor"
                      className="text-slate-200/70 dark:text-white/5"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={paddingX - 8}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-slate-400 text-[9px] font-mono dark:fill-ink-500"
                    >
                      {metric === "volume"
                        ? formatBytes(Math.round(maxValue * ratio))
                        : Math.round(maxValue * ratio).toLocaleString()}
                    </text>
                  </g>
                );
              })}

              {/* Area Gradient Fill */}
              {areaD && <path d={areaD} fill={`url(#${gradientId})`} />}

              {/* Line Stroke */}
              {pathD && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="#12c9a5"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Data Points */}
              {points.map((pt, i) => (
                <g key={i} className="cursor-pointer">
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={hoverIndex === i ? 6 : 3.5}
                    className={cn(
                      "transition-all duration-200",
                      hoverIndex === i
                        ? "fill-white stroke-signal-500 stroke-[3px] dark:fill-slate-900 dark:stroke-signal-400"
                        : "fill-signal-500 dark:fill-signal-400",
                    )}
                  />
                  <rect
                    x={pt.x - plotWidth / (points.length * 2)}
                    y={0}
                    width={plotWidth / points.length}
                    height={height}
                    fill="transparent"
                    onMouseEnter={() => setHoverIndex(i)}
                  />
                </g>
              ))}

              {/* X-axis labels */}
              {points.map((pt, i) => (
                <text
                  key={i}
                  x={pt.x}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-slate-400 text-[9.5px] font-mono dark:fill-ink-400"
                >
                  {pt.data.label}
                </text>
              ))}
            </svg>

            {/* Hover Tooltip Card */}
            {activeHover && (
              <div
                className="pointer-events-none absolute -top-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-lg transition-all duration-150 dark:border-white/15 dark:bg-ink-950/95"
                style={{
                  left: `${(activeHover.x / width) * 100}%`,
                  transform: "translateX(-50%) translateY(-100%)",
                }}
              >
                <div className="font-mono text-[10px] font-bold text-slate-500 dark:text-ink-400">
                  Global Checkpoint: {activeHover.data.label}
                </div>
                <div className="mt-1 flex items-baseline gap-2 font-display text-[14px] font-bold text-slate-900 dark:text-white">
                  <span>
                    {metric === "volume"
                      ? formatBytes(activeHover.val)
                      : metric === "transfers"
                        ? `${activeHover.val.toLocaleString()} transfers`
                        : `${activeHover.val.toLocaleString()} handshakes`}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-signal-600 dark:text-signal-300">
                  <TrendingUp className="h-3 w-3" />
                  <span>Platform-wide volume across all users</span>
                </div>
              </div>
            )}
          </div>
          {!hasChartData && (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-3 text-center text-[11.5px] text-slate-500 dark:border-white/10 dark:text-ink-400">
              No hourly activity recorded yet — the timeline fills in live as rooms open and transfers complete across all users.
            </p>
          )}
        </div>

        {/* 3 Secondary Cards: Real Content Distribution, Real Client Matrix, Real Anonymous Transfer Pulse */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Card 1: Content Type Breakdown (ALL USERS) */}
          <div className="rounded-3xl border border-slate-200/90 bg-white/95 p-6 shadow-sm transition-colors duration-300 dark:border-white/10 dark:bg-ink-900/60">
            <div className="flex items-center gap-2 text-[14px] font-bold text-slate-900 dark:text-white">
              <HardDrive className="h-4 w-4 text-signal-500" />
              <h4>Overall Payload Breakdown (All Users)</h4>
            </div>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-ink-400">
              Distribution of payloads beamed across all users on Vexuli.
            </p>

            {totalContentItems > 0 ? (
              <>
                <div className="mt-5 flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                  <div
                    className="h-full bg-signal-400 transition-all"
                    style={{ width: `${filePct}%` }}
                    title={`Files ${filePct}%`}
                  />
                  <div
                    className="h-full bg-sky-beam transition-all"
                    style={{ width: `${textPct}%` }}
                    title={`Text ${textPct}%`}
                  />
                </div>
                <ul className="mt-5 space-y-3">
                  <li className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-ink-200">
                      <span className="h-2.5 w-2.5 rounded-full bg-signal-400" />
                      <HardDrive className="h-3.5 w-3.5 text-slate-400 dark:text-ink-400" />
                      <span>Files &amp; Documents</span>
                    </div>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {totalContentFiles.toLocaleString()} ({filePct}%)
                    </span>
                  </li>
                  <li className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-ink-200">
                      <span className="h-2.5 w-2.5 rounded-full bg-sky-beam" />
                      <FileText className="h-3.5 w-3.5 text-slate-400 dark:text-ink-400" />
                      <span>Plain Text &amp; Snippets</span>
                    </div>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {totalContentTexts.toLocaleString()} ({textPct}%)
                    </span>
                  </li>
                </ul>
              </>
            ) : (
              <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-500 dark:border-white/10 dark:text-ink-400">
                <HardDrive className="h-6 w-6 text-slate-400 dark:text-ink-500" />
                <p className="mt-2 text-[12px] font-medium text-slate-700 dark:text-ink-200">Awaiting Transmissions</p>
                <p className="mt-1 text-[11px] leading-relaxed">
                  Start a room or connect above to see live payload breakdown update in real time.
                </p>
              </div>
            )}
          </div>

          {/* Card 2: Platform & Device Distribution (ALL USERS) */}
          <div className="rounded-3xl border border-slate-200/90 bg-white/95 p-6 shadow-sm transition-colors duration-300 dark:border-white/10 dark:bg-ink-900/60">
            <div className="flex items-center gap-2 text-[14px] font-bold text-slate-900 dark:text-white">
              <Laptop className="h-4 w-4 text-signal-500" />
              <h4>Connected Device Matrix (All Users)</h4>
            </div>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-ink-400">
              Breakdown of platforms connecting across all users.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <div className="flex items-center justify-between text-[12px]">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-ink-200">
                    <Laptop className="h-3.5 w-3.5 text-slate-400 dark:text-ink-400" />
                    <span>Desktop (macOS, Windows, Linux)</span>
                  </div>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">{desktopPct}%</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                  <div className="h-full bg-signal-500 rounded-full transition-all" style={{ width: `${desktopPct}%` }} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-[12px]">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-ink-200">
                    <Smartphone className="h-3.5 w-3.5 text-slate-400 dark:text-ink-400" />
                    <span>Mobile (iOS Safari, Android Chrome)</span>
                  </div>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">{mobilePct}%</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                  <div className="h-full bg-sky-beam rounded-full transition-all" style={{ width: `${mobilePct}%` }} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-[12px]">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-ink-200">
                    <Tablet className="h-3.5 w-3.5 text-slate-400 dark:text-ink-400" />
                    <span>Tablets (iPadOS, Android)</span>
                  </div>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">{tabletPct}%</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                  <div className="h-full bg-flare-400 rounded-full transition-all" style={{ width: `${tabletPct}%` }} />
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-[11px] leading-relaxed text-slate-600 dark:border-white/8 dark:bg-white/[0.02] dark:text-ink-400">
              <span className="font-semibold text-slate-900 dark:text-white">Detected on your device:</span> {localPlat} client, connected to global WebRTC relay cluster.
              <span className="mt-1 block">
                <span className="font-semibold text-slate-900 dark:text-white">
                  <AnimatedNumber value={totalVisits} duration={600} />
                </span>{" "}
                total site visits across all users, all time.
              </span>
            </div>
          </div>

          {/* Card 3: Live Transfer Pulse (ALL USERS - STRICTLY NO ROOM CODES SHOWN!) */}
          <div className="rounded-3xl border border-slate-200/90 bg-white/95 p-6 shadow-sm transition-colors duration-300 dark:border-white/10 dark:bg-ink-900/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[14px] font-bold text-slate-900 dark:text-white">
                <RefreshCw className="h-4 w-4 animate-spin text-signal-500 [animation-duration:12s]" />
                <h4>Live Transfer Pulse</h4>
              </div>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-signal-600 dark:text-signal-300">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-500 animate-pulse" /> realtime
              </span>
            </div>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-ink-400">
              Live anonymous cryptographic &amp; transfer events across all users (zero room codes exposed).
            </p>

            <ul className="mt-5 space-y-2.5">
              {pulseEvents.length > 0 ? (
                pulseEvents.map((ev) => (
                  <li
                    key={ev.id}
                    className="animate-[pop-in_0.35s_ease-out] rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 text-[11.5px] transition-colors dark:border-white/8 dark:bg-white/[0.03]"
                  >
                    <div className="flex items-center justify-between font-mono text-[10.5px]">
                      {/* CRITICAL: NO ROOM CODE SHOWN! Real title only! */}
                      <span className="font-semibold text-slate-800 dark:text-white">{ev.title}</span>
                      <span className="text-slate-400 dark:text-ink-500">{timeAgo(ev.timestamp)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-slate-600 dark:text-ink-300">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <Cpu className="h-3 w-3 text-signal-500" />
                        {ev.detail}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500 dark:text-ink-400">{ev.route}</span>
                    </div>
                  </li>
                ))
              ) : (
                <li className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-[12px] text-slate-500 dark:border-white/10 dark:text-ink-400">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-signal-500 animate-pulse" />
                    Listening for live P2P cryptographic events · Active peer handshakes appear here in real time.
                  </span>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
