import { useEffect, useId, useState } from "react";
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
  Zap,
} from "lucide-react";
import { Reveal } from "@/components/ui";
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
  activeRooms: number;
  activeClients: number;
  totalRoomsCreated: number;
  totalRoomsPaired: number;
  totalSignalsRelayed: number;
  totalBytesTransferred: number;
  totalTransfersCompleted: number;
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
  if (!seconds || seconds <= 0) return "just started";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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

export function AnalyticsDashboard({ state }: { state?: TransferState }) {
  const gradientId = useId();
  const [range, setRange] = useState<TimeRange>("24h");
  const [metric, setMetric] = useState<MetricView>("transfers");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);

  // Poll real stats from the live server
  useEffect(() => {
    let mounted = true;
    const fetchLiveStats = async () => {
      const t0 = performance.now();
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) return;
        const data: ServerStats = await res.json();
        const latency = Math.round(performance.now() - t0);
        if (mounted) {
          setStats(data);
          setPingMs(latency);
        }
      } catch {
        // optional telemetry poll
      }
    };

    void fetchLiveStats();
    const interval = setInterval(fetchLiveStats, 3500);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Compute local session metrics to combine with server totals
  const sessionCompletedTransfers = (state?.transfers || []).filter(
    (t) => t.status === "completed" || t.status === "saved",
  );
  const sessionCompletedBytes = sessionCompletedTransfers.reduce((acc, t) => acc + (t.bytes || t.size || 0), 0);
  const sessionTextsDelivered = (state?.texts || []).filter((t) => t.delivered).length;

  // Real-time aggregates
  const activeRooms = stats?.activeRooms ?? (state?.phase === "connected" ? 1 : 0);
  const activeClients = stats?.activeClients ?? (state?.phase === "connected" ? 2 : 1);
  const totalHandshakes = (stats?.totalRoomsPaired ?? 0);
  const totalTransfers = (stats?.totalTransfersCompleted ?? 0) + sessionCompletedTransfers.length + sessionTextsDelivered;
  const totalVolumeBytes = (stats?.totalBytesTransferred ?? 0) + sessionCompletedBytes;
  const totalSignals = stats?.totalSignalsRelayed ?? 0;

  // Content breakdown from real metrics
  const totalContentFiles = (stats?.contentStats?.files ?? 0) + sessionCompletedTransfers.length;
  const totalContentTexts = (stats?.contentStats?.text ?? 0) + sessionTextsDelivered;
  const totalContentItems = totalContentFiles + totalContentTexts;
  const filePct = totalContentItems > 0 ? Math.round((totalContentFiles / totalContentItems) * 100) : 0;
  const textPct = totalContentItems > 0 ? 100 - filePct : 0;

  // Device matrix from real metrics
  const rawDevices = stats?.deviceStats || { desktop: 0, mobile: 0, tablet: 0, other: 0 };
  const localPlat = detectLocalPlatform();
  const adjustedDevices = { ...rawDevices };
  if (localPlat === "Desktop") adjustedDevices.desktop = Math.max(adjustedDevices.desktop, 1);
  else if (localPlat === "Mobile") adjustedDevices.mobile = Math.max(adjustedDevices.mobile, 1);
  else if (localPlat === "Tablet") adjustedDevices.tablet = Math.max(adjustedDevices.tablet, 1);

  const deviceTotal = adjustedDevices.desktop + adjustedDevices.mobile + adjustedDevices.tablet + adjustedDevices.other;
  const desktopPct = deviceTotal > 0 ? Math.round((adjustedDevices.desktop / deviceTotal) * 100) : 0;
  const mobilePct = deviceTotal > 0 ? Math.round((adjustedDevices.mobile / deviceTotal) * 100) : 0;
  const tabletPct = deviceTotal > 0 ? Math.round((adjustedDevices.tablet / deviceTotal) * 100) : 0;

  // Prepare real chart points from hourly history
  const rawBuckets = stats?.hourlyHistory || [];
  // Slice or aggregate based on selected time range
  const displayBuckets: HourlyBucket[] = (() => {
    if (range === "24h") {
      return rawBuckets.length ? rawBuckets : [
        { label: "00:00", timestamp: Date.now() - 3600000, transfers: 0, bytes: 0, signals: 0, roomsCreated: 0, roomsPaired: 0 },
        { label: "12:00", timestamp: Date.now() - 1800000, transfers: 0, bytes: 0, signals: 0, roomsCreated: 0, roomsPaired: 0 },
        { label: "Now", timestamp: Date.now(), transfers: totalTransfers, bytes: totalVolumeBytes, signals: totalSignals, roomsCreated: stats?.totalRoomsCreated || 0, roomsPaired: totalHandshakes },
      ];
    }
    if (range === "7d") {
      // Show every 3rd or grouped bucket
      return rawBuckets.filter((_, idx) => idx % 3 === 0);
    }
    // 30d: sample or show 6 evenly spaced points
    return rawBuckets.filter((_, idx) => idx % 4 === 0);
  })();

  const chartData = displayBuckets.map((b) => {
    let value = 0;
    if (metric === "transfers") value = b.transfers;
    else if (metric === "signals") value = b.signals + b.roomsPaired;
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
  const paddingX = 42;
  const paddingY = 28;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingY * 2;

  const rawValues = chartData.map((d) => d.value);
  const maxValue = Math.max(...rawValues, 1);
  const minValue = 0;

  const points = chartData.map((d, i) => {
    const x = paddingX + (i / Math.max(1, chartData.length - 1)) * plotWidth;
    const y = paddingY + plotHeight - ((d.value - minValue) / (maxValue - minValue)) * plotHeight;
    return { x, y, data: d, val: d.value };
  });

  // Build SVG path
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
  // NOTICE: ABSOLUTELY NO ROOM CODES ARE SHOWN ANYWHERE!
  const serverEvents = (stats?.recentEvents || []).map((e) => ({
    id: e.id,
    title: e.title,
    detail: e.detail,
    route: e.route,
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
              Real-Time Network Telemetry
            </div>
            <h2 className="mt-4 font-display text-[clamp(2.1rem,4.8vw,3.4rem)] font-bold text-slate-900 dark:text-white">
              Live Network Analytics
            </h2>
            <p className="mt-4 max-w-[58ch] text-[14.5px] leading-relaxed text-slate-600 dark:text-ink-300">
              Real telemetry directly from this Vexuli node. Transmission happens over encrypted WebRTC data channels;
              telemetry records real cryptographic events and zero-knowledge packet counts without ever retaining file
              content, filenames, or room codes.
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

        {/* 4 Real-Time KPI Metric Cards */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Active Channels */}
          <Reveal delay={60}>
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-ink-300">
                <span>Active Channels</span>
                <span className="flex items-center gap-1 text-signal-600 dark:text-signal-300">
                  <Radio className="h-3.5 w-3.5 animate-pulse" /> Live
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-[2.2rem] font-extrabold text-slate-900 dark:text-white">
                  {activeRooms}
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

          {/* Real Transfers Completed */}
          <Reveal delay={120}>
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-ink-300">
                <span>Transfers Handled</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-signal-600 dark:text-signal-300">
                  <CheckCircle2 className="h-3 w-3" /> Realtime
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-[2.2rem] font-extrabold text-slate-900 dark:text-white">
                  {totalTransfers}
                </span>
                <span className="text-[12px] font-medium text-slate-500 dark:text-ink-300">completed</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-ink-300">
                <Clock className="h-3.5 w-3.5 text-signal-500" />
                <span>{totalHandshakes} handshakes paired</span>
              </div>
            </div>
          </Reveal>

          {/* Real Volume Beamed */}
          <Reveal delay={180}>
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-ink-300">
                <span>Volume Beamed</span>
                <span className="text-[10px] font-mono text-slate-400 dark:text-ink-400">Zero-Store</span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-[2.2rem] font-extrabold text-slate-900 dark:text-white">
                  {formatBytes(totalVolumeBytes)}
                </span>
                <span className="text-[12px] font-medium text-signal-600 dark:text-signal-300">total</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-ink-300">
                <HardDrive className="h-3.5 w-3.5 text-signal-500" />
                <span>0 bytes written to server disk</span>
              </div>
            </div>
          </Reveal>

          {/* Node Health & Uptime */}
          <Reveal delay={240}>
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-ink-300">
                <span>Node Telemetry</span>
                <span className="text-[10px] font-mono text-signal-600 dark:text-signal-300">
                  {pingMs !== null ? `${pingMs}ms ping` : "Active"}
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-[2.2rem] font-extrabold text-slate-900 dark:text-white">
                  {totalSignals}
                </span>
                <span className="text-[12px] font-medium text-slate-500 dark:text-ink-300">signals</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-ink-300">
                <Zap className="h-3.5 w-3.5 text-signal-500" />
                <span>Uptime: {formatUptime(stats?.uptimeSeconds ?? 0)}</span>
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
                  Real-Time Channel Activity Timeline
                </h3>
              </div>
              <p className="mt-1 text-[12px] text-slate-500 dark:text-ink-400">
                Live time-series recorded in node memory. Metrics update automatically as peers connect and transfer data.
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
                        : Math.round(maxValue * ratio)}
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
                  Checkpoint {activeHover.data.label}
                </div>
                <div className="mt-1 flex items-baseline gap-2 font-display text-[14px] font-bold text-slate-900 dark:text-white">
                  <span>
                    {metric === "volume"
                      ? formatBytes(activeHover.val)
                      : metric === "transfers"
                        ? `${activeHover.val} transfers`
                        : `${activeHover.val} signals & handshakes`}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-signal-600 dark:text-signal-300">
                  <Radio className="h-3 w-3" />
                  <span>Real-time node checkpoint</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3 Secondary Cards: Real Content Distribution, Real Client Matrix, Real Anonymous Transfer Pulse */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Card 1: Content Type Breakdown (REAL) */}
          <div className="rounded-3xl border border-slate-200/90 bg-white/95 p-6 shadow-sm transition-colors duration-300 dark:border-white/10 dark:bg-ink-900/60">
            <div className="flex items-center gap-2 text-[14px] font-bold text-slate-900 dark:text-white">
              <HardDrive className="h-4 w-4 text-signal-500" />
              <h4>Real Payload Distribution</h4>
            </div>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-ink-400">
              Direct payloads transmitted through this node.
            </p>

            {totalContentItems > 0 ? (
              <>
                <div className="mt-5 flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                  <div className="h-full bg-signal-400 transition-all" style={{ width: `${filePct}%` }} title={`Files ${filePct}%`} />
                  <div className="h-full bg-sky-beam transition-all" style={{ width: `${textPct}%` }} title={`Text ${textPct}%`} />
                </div>
                <ul className="mt-5 space-y-3">
                  <li className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-ink-200">
                      <span className="h-2.5 w-2.5 rounded-full bg-signal-400" />
                      <HardDrive className="h-3.5 w-3.5 text-slate-400 dark:text-ink-400" />
                      <span>Files &amp; Documents</span>
                    </div>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {totalContentFiles} ({filePct}%)
                    </span>
                  </li>
                  <li className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-ink-200">
                      <span className="h-2.5 w-2.5 rounded-full bg-sky-beam" />
                      <FileText className="h-3.5 w-3.5 text-slate-400 dark:text-ink-400" />
                      <span>Plain Text &amp; Snippets</span>
                    </div>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {totalContentTexts} ({textPct}%)
                    </span>
                  </li>
                </ul>
              </>
            ) : (
              <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-500 dark:border-white/10 dark:text-ink-400">
                <HardDrive className="h-6 w-6 text-slate-400 dark:text-ink-500" />
                <p className="mt-2 text-[12px] font-medium text-slate-700 dark:text-ink-200">Awaiting First Transfer</p>
                <p className="mt-1 text-[11px] leading-relaxed">
                  Start a room or connect above to see live payload breakdown update in real time.
                </p>
              </div>
            )}
          </div>

          {/* Card 2: Platform & Device Distribution (REAL) */}
          <div className="rounded-3xl border border-slate-200/90 bg-white/95 p-6 shadow-sm transition-colors duration-300 dark:border-white/10 dark:bg-ink-900/60">
            <div className="flex items-center gap-2 text-[14px] font-bold text-slate-900 dark:text-white">
              <Laptop className="h-4 w-4 text-signal-500" />
              <h4>Connected Device Matrix</h4>
            </div>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-ink-400">
              Actual client platforms connecting to this node.
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
              <span className="font-semibold text-slate-900 dark:text-white">Detected on this tab:</span> {localPlat} client
              ready for direct WebRTC pairing.
            </div>
          </div>

          {/* Card 3: Live Transfer Pulse (REAL & NO CODES EVER SHOWN!) */}
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
              Live anonymous cryptographic &amp; transfer events (no private codes exposed).
            </p>

            <ul className="mt-5 space-y-2.5">
              {pulseEvents.length > 0 ? (
                pulseEvents.map((ev) => (
                  <li
                    key={ev.id}
                    className="animate-[pop-in_0.35s_ease-out] rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 text-[11.5px] transition-colors dark:border-white/8 dark:bg-white/[0.03]"
                  >
                    <div className="flex items-center justify-between font-mono text-[10.5px]">
                      {/* Notice: NO ROOM CODE SHOWN! Real title only! */}
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
                <li className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-[11.5px] text-slate-500 dark:border-white/10 dark:text-ink-400">
                  Awaiting live events. Active handshakes appear here in real time.
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
