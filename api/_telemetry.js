import { randomUUID } from "node:crypto";

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

export function recordTransfer({ bytes = 0, type = "file", route = "Direct P2P" }) {
  memoryState.totalBytesTransferred += bytes;
  memoryState.totalTransfersCompleted += 1;
  if (type === "text") memoryState.contentStats.text++;
  else memoryState.contentStats.files++;

  memoryState.recentEvents.unshift({
    id: randomUUID(),
    title: type === "text" ? "Encrypted Text Payload" : "Direct File Transfer Completed",
    detail: `${formatBytes(bytes)} transferred peer-to-peer`,
    route: route === "relay" ? "TURN Relay" : "Direct P2P",
    timestamp: Date.now(),
  });
  if (memoryState.recentEvents.length > 25) memoryState.recentEvents.pop();
}

export function getGlobalStats() {
  return {
    overallPlatform: true,
    activeRooms: 0,
    activeClients: 0,
    totalRoomsCreated: memoryState.totalRoomsCreated,
    totalRoomsPaired: memoryState.totalRoomsPaired,
    totalSignalsRelayed: memoryState.totalSignalsRelayed,
    totalBytesTransferred: memoryState.totalBytesTransferred,
    totalTransfersCompleted: memoryState.totalTransfersCompleted,
    contentStats: memoryState.contentStats,
    deviceStats: memoryState.deviceStats,
    uptimeSeconds: Math.floor((Date.now() - memoryState.serverStartedAt) / 1000),
    serverStartedAt: memoryState.serverStartedAt,
    serverTime: Date.now(),
    hourlyHistory: memoryState.hourlyHistory,
    recentEvents: memoryState.recentEvents,
  };
}
