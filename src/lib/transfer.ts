export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_TEXT_CHARS = 4000;

const CHUNK_BYTES = 16 * 1024;
const HIGH_WATER = 512 * 1024;
const ACK_INTERVAL = 256 * 1024;
const IN_FLIGHT_LIMIT = 768 * 1024;

export type Phase =
  | "idle"
  | "creating"
  | "waiting"
  | "joining"
  | "requesting"
  | "approval"
  | "connecting"
  | "connected"
  | "ended";

export type TransferStatus =
  | "queued"
  | "awaiting"
  | "sending"
  | "receiving"
  | "finalizing"
  | "completed"
  | "saved"
  | "declined"
  | "cancelled"
  | "failed";

export type TransferView = {
  id: string;
  name: string;
  size: number;
  bytes: number;
  direction: "outgoing" | "incoming";
  status: TransferStatus;
  url?: string;
};

export type MessageView = {
  id: string;
  text: string;
  fromMe: boolean;
  time: number;
  delivered: boolean;
};

export type FileOffer = { id: string; name: string; size: number; mime: string };

export type TransferState = {
  phase: Phase;
  role: "host" | "guest" | null;
  code: string | null;
  expiresAt: number | null;
  phrase: string | null;
  peerLabel: string | null;
  serverOnline: boolean | null;
  relayConfigured: boolean | null;
  reconnecting: boolean;
  connectionRoute: "direct" | "relay" | null;
  message: string | null;
  incomingOffer: FileOffer | null;
  transfers: TransferView[];
  texts: MessageView[];
};

type ServerSignal =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit };

type Outgoing = { id: string; file: File; sent: number; acked: number; cancelled: boolean; pumping: boolean };
type Incoming = {
  offer: FileOffer;
  bytes: number;
  acknowledged: number;
  chunks: ArrayBuffer[];
  writer: FileSystemWritableFileStream | null;
  chain: Promise<void>;
  cancelled: boolean;
};

const initial: TransferState = {
  phase: "idle",
  role: null,
  code: null,
  expiresAt: null,
  phrase: null,
  peerLabel: null,
  serverOnline: null,
  relayConfigured: null,
  reconnecting: false,
  connectionRoute: null,
  message: null,
  incomingOffer: null,
  transfers: [],
  texts: [],
};

function serverOrigin() {
  const override = import.meta.env.VITE_APP_SERVER_ORIGIN as string | undefined;
  if (override) return override.replace(/\/$/, "");
  if (import.meta.env.DEV) return `${window.location.protocol}//${window.location.hostname}:3001`;
  return window.location.origin;
}

function socketUrl() {
  const origin = new URL(serverOrigin());
  origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  origin.pathname = "/signal";
  return origin.toString();
}

function browserLabel() {
  const agent = navigator.userAgent;
  const browser = /Firefox/i.test(agent)
    ? "Firefox"
    : /Edg\//i.test(agent)
      ? "Edge"
      : /Chrome/i.test(agent)
        ? "Chrome"
        : /Safari/i.test(agent)
          ? "Safari"
          : "Browser";
  const system = /iPad/i.test(agent)
    ? "iPad"
    : /iPhone/i.test(agent)
      ? "iPhone"
      : /Android/i.test(agent)
        ? "Android"
        : /Windows/i.test(agent)
          ? "Windows"
          : /Mac/i.test(agent)
            ? "Mac"
            : /Linux/i.test(agent)
              ? "Linux"
              : "device";
  return `${browser} on ${system}`;
}

function safeName(value: string) {
  return value.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 160).trim() || "file";
}

function displayError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

type FilePickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
};

/** The signaling socket sees only connection descriptions. All content uses WebRTC. */
export class TransferEngine {
  private snapshot: TransferState = initial;
  private subscribers = new Set<() => void>();
  private socket: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private iceServers: RTCIceServer[] = [];
  private earlyCandidates: RTCIceCandidateInit[] = [];
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Outgoing[] = [];
  private outgoing: Outgoing | null = null;
  private incoming: Incoming | null = null;
  private urls = new Set<string>();

  subscribe = (listener: () => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private update(changes: Partial<TransferState>) {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of this.subscribers) listener();
  }

  private editTransfer(id: string, changes: Partial<TransferView>) {
    this.update({
      transfers: this.snapshot.transfers.map((transfer) =>
        transfer.id === id ? { ...transfer, ...changes } : transfer,
      ),
    });
  }

  private notify(message: string) {
    this.update({ message });
  }

  dismissMessage() {
    this.update({ message: null });
  }

  async checkServer() {
    try {
      const response = await fetch(`${serverOrigin()}/api/config`, { cache: "no-store" });
      if (!response.ok) throw new Error("Server unavailable");
      const data = (await response.json()) as { relayConfigured: boolean };
      this.update({ serverOnline: true, relayConfigured: Boolean(data.relayConfigured) });
    } catch {
      this.update({ serverOnline: false, relayConfigured: null });
    }
  }

  private sendSignal(payload: object) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private sendControl(payload: object) {
    if (this.channel?.readyState !== "open") return false;
    this.channel.send(JSON.stringify(payload));
    return true;
  }

  private stopConnection() {
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
    this.outgoing && (this.outgoing.cancelled = true);
    this.incoming && (this.incoming.cancelled = true);
    if (this.incoming?.writer) void this.incoming.writer.abort().catch(() => {});
    this.outgoing = null;
    this.incoming = null;
    this.queue = [];
    this.earlyCandidates = [];
    if (this.snapshot.transfers.some((item) => ["queued", "awaiting", "sending", "receiving", "finalizing"].includes(item.status))) {
      this.update({
        transfers: this.snapshot.transfers.map((item) =>
          ["queued", "awaiting", "sending", "receiving", "finalizing"].includes(item.status)
            ? { ...item, status: "failed" }
            : item,
        ),
      });
    }

    const channel = this.channel;
    this.channel = null;
    if (channel) {
      channel.onclose = null;
      channel.onmessage = null;
      channel.close();
    }
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.ondatachannel = null;
      pc.onconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.close();
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "leave" }));
        socket.close(1000, "Leaving room");
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  }

  private clearLocalDownloads() {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  releaseDownload(id: string) {
    const transfer = this.snapshot.transfers.find((item) => item.id === id);
    if (!transfer?.url) return;
    URL.revokeObjectURL(transfer.url);
    this.urls.delete(transfer.url);
    this.editTransfer(id, { url: undefined, status: "saved" });
  }

  leave() {
    this.stopConnection();
    this.update({ phase: "ended", incomingOffer: null, reconnecting: false, message: null });
  }

  dispose() {
    this.stopConnection();
    this.clearLocalDownloads();
  }

  private resetForNewSession() {
    this.stopConnection();
    this.clearLocalDownloads();
    this.snapshot = {
      ...initial,
      serverOnline: this.snapshot.serverOnline,
      relayConfigured: this.snapshot.relayConfigured,
    };
    for (const listener of this.subscribers) listener();
  }

  private async openSocket() {
    return new Promise<WebSocket>((resolve, reject) => {
      let finished = false;
      const socket = new WebSocket(socketUrl());
      this.socket = socket;
      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        socket.close();
        reject(new Error("The signaling server did not respond. Please try again."));
      }, 10_000);
      socket.onopen = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        this.update({ serverOnline: true });
        resolve(socket);
      };
      socket.onerror = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        reject(new Error("Cannot reach the transfer server. Please try again in a moment."));
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (this.socket !== socket) return;
        if (!finished) {
          finished = true;
          reject(new Error("The transfer server closed the connection."));
        }
        this.socket = null;
        this.stopConnection();
        this.update({
          phase: "ended",
          reconnecting: false,
          serverOnline: false,
          incomingOffer: null,
          message: "Connection to the transfer server was lost. Start a new room to continue.",
        });
      };
      socket.onmessage = (event) => {
        try {
          void this.handleServerMessage(JSON.parse(event.data as string));
        } catch {
          this.notify("The server sent an invalid response.");
        }
      };
    });
  }

  async createRoom() {
    this.resetForNewSession();
    this.update({ phase: "creating", role: "host" });
    try {
      await this.openSocket();
      this.sendSignal({ type: "create", label: browserLabel() });
    } catch (error) {
      this.stopConnection();
      this.update({ phase: "idle", serverOnline: false, message: displayError(error) });
    }
  }

  async joinRoom(code: string) {
    if (!/^\d{4}$/.test(code)) {
      this.notify("Enter a four-digit code.");
      return;
    }
    this.resetForNewSession();
    this.update({ phase: "joining", role: "guest", code });
    try {
      await this.openSocket();
      this.sendSignal({ type: "join", code, label: browserLabel() });
    } catch (error) {
      this.stopConnection();
      this.update({ phase: "idle", serverOnline: false, message: displayError(error) });
    }
  }

  approve() {
    if (this.snapshot.phase !== "approval") return;
    this.update({ phase: "connecting" });
    this.sendSignal({ type: "approve" });
    this.startConnectionTimeout();
  }

  reject() {
    if (this.snapshot.phase !== "approval") return;
    this.sendSignal({ type: "reject" });
    this.update({ phase: "waiting", phrase: null, peerLabel: null });
  }

  private startConnectionTimeout() {
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = setTimeout(() => {
      if (this.snapshot.phase !== "connecting") return;
      this.stopConnection();
      this.update({
        phase: "ended",
        message: "Devices could not connect. Try a new room. Different networks may require a TURN relay.",
      });
    }, 35_000);
  }

  private async handleServerMessage(message: Record<string, unknown>) {
    switch (message.type) {
      case "created":
        this.iceServers = Array.isArray(message.iceServers) ? (message.iceServers as RTCIceServer[]) : [];
        this.update({
          phase: "waiting",
          code: String(message.code),
          expiresAt: Number(message.expiresAt),
          message: null,
        });
        break;
      case "joined":
        this.iceServers = Array.isArray(message.iceServers) ? (message.iceServers as RTCIceServer[]) : [];
        this.update({
          phase: "requesting",
          phrase: String(message.phrase),
          peerLabel: String(message.ownerLabel || "Other device"),
          message: null,
        });
        break;
      case "join-request":
        this.update({
          phase: "approval",
          phrase: String(message.phrase),
          peerLabel: String(message.guestLabel || "Another browser"),
        });
        break;
      case "waiting":
        this.update({ phase: "waiting", expiresAt: Number(message.expiresAt), phrase: null, peerLabel: null });
        break;
      case "approved":
        this.update({ phase: "connecting", peerLabel: String(message.peerLabel || "Other device") });
        this.startConnectionTimeout();
        break;
      case "peer-ready":
        this.update({ phase: "connecting", peerLabel: String(message.peerLabel || "Other device") });
        this.startConnectionTimeout();
        try {
          const pc = this.makePeer();
          this.setupChannel(pc.createDataChannel("vexuli-transfer", { ordered: true }));
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.sendSignal({ type: "signal", signal: { description: pc.localDescription?.toJSON() } });
        } catch (error) {
          this.failConnection(`Could not prepare the connection: ${displayError(error)}`);
        }
        break;
      case "signal":
        if (message.signal && typeof message.signal === "object") {
          try {
            await this.handlePeerSignal(message.signal as ServerSignal);
          } catch (error) {
            this.failConnection(`The secure connection failed: ${displayError(error)}`);
          }
        }
        break;
      case "rejected":
      case "room-expired":
      case "peer-left":
        this.stopConnection();
        this.update({
          phase: "ended",
          incomingOffer: null,
          reconnecting: false,
          message: String(message.message || "The room has closed."),
        });
        break;
      case "error":
        if (this.snapshot.phase === "joining" || this.snapshot.phase === "creating") {
          this.stopConnection();
          this.update({ phase: "idle", message: String(message.message || "Could not open room.") });
        } else {
          this.notify(String(message.message || "The server could not complete the request."));
        }
        break;
      default:
        break;
    }
  }

  private makePeer() {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate) this.sendSignal({ type: "signal", signal: { candidate: event.candidate.toJSON() } });
    };
    pc.ondatachannel = (event) => this.setupChannel(event.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        this.failConnection("The devices could not establish a secure channel. Try again, or configure TURN for restrictive networks.");
      } else if (pc.connectionState === "disconnected" && this.snapshot.phase === "connected") {
        this.update({ reconnecting: true });
      } else if (pc.connectionState === "connected") {
        this.update({ reconnecting: false });
      }
    };
    return pc;
  }

  private async handlePeerSignal(signal: ServerSignal) {
    const pc = this.makePeer();
    if ("candidate" in signal) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(signal.candidate);
      } else {
        this.earlyCandidates.push(signal.candidate);
      }
      return;
    }
    await pc.setRemoteDescription(signal.description);
    for (const candidate of this.earlyCandidates.splice(0)) await pc.addIceCandidate(candidate);
    if (signal.description.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal({ type: "signal", signal: { description: pc.localDescription?.toJSON() } });
    }
  }

  private setupChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 128 * 1024;
    channel.onopen = () => {
      if (this.connectionTimer) clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
      this.update({ phase: "connected", reconnecting: false, message: null });
      void this.detectConnectionRoute();
      this.processQueue();
    };
    channel.onclose = () => {
      if (this.channel !== channel || this.snapshot.phase === "ended") return;
      this.stopConnection();
      this.update({ phase: "ended", incomingOffer: null, message: "The secure channel closed. Start a new room to continue." });
    };
    channel.onmessage = (event) => {
      if (typeof event.data === "string") {
        this.handleControl(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        this.receiveChunk(event.data);
      }
    };
  }

  private failConnection(message: string) {
    this.stopConnection();
    this.update({ phase: "ended", incomingOffer: null, reconnecting: false, message });
  }

  private async detectConnectionRoute() {
    if (!this.pc) return;
    try {
      const report = await this.pc.getStats();
      let selectedId: string | undefined;
      report.forEach((stat) => {
        if (stat.type === "transport") selectedId = stat.selectedCandidatePairId;
      });
      const pair = selectedId ? report.get(selectedId) : undefined;
      if (!pair) return;
      const local = report.get(pair.localCandidateId);
      const remote = report.get(pair.remoteCandidateId);
      const route = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "relay" : "direct";
      this.update({ connectionRoute: route });
    } catch {
      // Route details are optional; the browser may redact candidate stats.
    }
  }

  sendText(text: string) {
    if (this.snapshot.phase !== "connected") return false;
    if (!text.trim()) return false;
    if (text.length > MAX_TEXT_CHARS) {
      this.notify(`Text is limited to ${MAX_TEXT_CHARS.toLocaleString()} characters. Send a .txt file instead.`);
      return false;
    }
    const id = crypto.randomUUID();
    if (!this.sendControl({ type: "text", id, text })) return false;
    this.update({ texts: [...this.snapshot.texts, { id, text, fromMe: true, time: Date.now(), delivered: false }] });
    return true;
  }

  queueFiles(files: File[]) {
    if (this.snapshot.phase !== "connected") {
      this.notify("Connect two devices before adding files.");
      return;
    }
    const accepted: Outgoing[] = [];
    let ignored = 0;
    for (const file of files.slice(0, 20)) {
      if (file.size > MAX_FILE_BYTES) {
        ignored += 1;
        continue;
      }
      accepted.push({ id: crypto.randomUUID(), file, sent: 0, acked: 0, cancelled: false, pumping: false });
    }
    if (files.length > 20) ignored += files.length - 20;
    if (ignored) this.notify(`${ignored} file${ignored === 1 ? " was" : "s were"} skipped. Limit: 20 files, 100 MB each.`);
    if (!accepted.length) return;
    this.queue.push(...accepted);
    this.update({
      transfers: [
        ...accepted.map(({ id, file }) => ({
          id,
          name: safeName(file.name),
          size: file.size,
          bytes: 0,
          direction: "outgoing" as const,
          status: "queued" as const,
        })),
        ...this.snapshot.transfers,
      ],
    });
    this.processQueue();
  }

  private processQueue() {
    if (this.outgoing || this.channel?.readyState !== "open" || !this.queue.length) return;
    const next = this.queue.shift()!;
    this.outgoing = next;
    this.editTransfer(next.id, { status: "awaiting" });
    this.sendControl({
      type: "file-offer",
      id: next.id,
      name: safeName(next.file.name),
      size: next.file.size,
      mime: next.file.type.slice(0, 128),
    });
  }

  private async waitForCapacity(transfer: Outgoing, channel: RTCDataChannel) {
    const started = Date.now();
    while (
      channel.bufferedAmount > HIGH_WATER ||
      (this.outgoing?.id === transfer.id && transfer.sent - transfer.acked > IN_FLIGHT_LIMIT)
    ) {
      if (channel.readyState !== "open" || transfer.cancelled) throw new Error("Transfer interrupted.");
      if (Date.now() - started > 90_000) throw new Error("Transfer stalled. Check both connections and try again.");
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  private async pumpFile(transfer: Outgoing) {
    const channel = this.channel;
    if (!channel || this.outgoing !== transfer || transfer.pumping) return;
    transfer.pumping = true;
    this.editTransfer(transfer.id, { status: "sending" });
    let offset = 0;
    let lastPaint = 0;
    try {
      while (offset < transfer.file.size) {
        if (transfer.cancelled || this.outgoing !== transfer || channel.readyState !== "open") return;
        await this.waitForCapacity(transfer, channel);
        const data = await transfer.file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
        if (transfer.cancelled || this.outgoing !== transfer || channel.readyState !== "open") return;
        channel.send(data);
        offset += data.byteLength;
        transfer.sent = offset;
        if (Date.now() - lastPaint > 100 || offset === transfer.file.size) {
          this.editTransfer(transfer.id, { bytes: offset });
          lastPaint = Date.now();
        }
      }
      if (this.outgoing !== transfer || transfer.cancelled) return;
      this.editTransfer(transfer.id, { bytes: offset, status: "finalizing" });
      this.sendControl({ type: "file-complete", id: transfer.id });
    } catch (error) {
      if (this.outgoing !== transfer || transfer.cancelled) return;
      this.sendControl({ type: "file-cancel", id: transfer.id });
      this.editTransfer(transfer.id, { status: "failed" });
      this.outgoing = null;
      this.notify(displayError(error));
      this.processQueue();
    }
  }

  async acceptFile() {
    const offer = this.snapshot.incomingOffer;
    if (!offer || this.incoming || this.channel?.readyState !== "open") return;
    let writer: FileSystemWritableFileStream | null = null;
    const picker = (window as FilePickerWindow).showSaveFilePicker;
    if (picker && window.isSecureContext) {
      try {
        // Invoked from the user's Accept click so the browser can grant write permission.
        const handle = await picker.call(window, { suggestedName: offer.name });
        writer = await handle.createWritable();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Safari/Firefox and restricted environments fall back to a local download.
      }
    }
    if (this.snapshot.incomingOffer?.id !== offer.id || this.channel?.readyState !== "open") {
      if (writer) void writer.abort().catch(() => {});
      return;
    }
    this.incoming = { offer, bytes: 0, acknowledged: 0, chunks: [], writer, chain: Promise.resolve(), cancelled: false };
    this.update({ incomingOffer: null });
    this.editTransfer(offer.id, { status: "receiving" });
    this.sendControl({ type: "file-accept", id: offer.id });
  }

  declineFile() {
    const offer = this.snapshot.incomingOffer;
    if (!offer) return;
    this.sendControl({ type: "file-decline", id: offer.id });
    this.editTransfer(offer.id, { status: "declined" });
    this.update({ incomingOffer: null });
  }

  cancelFile(id: string) {
    const queuedIndex = this.queue.findIndex((item) => item.id === id);
    if (queuedIndex !== -1) {
      this.queue.splice(queuedIndex, 1);
      this.editTransfer(id, { status: "cancelled" });
      return;
    }
    if (this.snapshot.incomingOffer?.id === id) {
      this.declineFile();
      return;
    }
    if (this.outgoing?.id === id) {
      this.outgoing.cancelled = true;
      this.outgoing = null;
      this.sendControl({ type: "file-cancel", id });
      this.editTransfer(id, { status: "cancelled" });
      this.processQueue();
    } else if (this.incoming?.offer.id === id) {
      this.incoming.cancelled = true;
      if (this.incoming.writer) void this.incoming.writer.abort().catch(() => {});
      this.incoming = null;
      this.sendControl({ type: "file-cancel", id });
      this.editTransfer(id, { status: "cancelled" });
    }
  }

  private receiveChunk(data: ArrayBuffer) {
    const incoming = this.incoming;
    if (!incoming || incoming.cancelled) return;
    incoming.chain = incoming.chain.then(async () => {
      if (incoming.cancelled) return;
      if (incoming.bytes + data.byteLength > incoming.offer.size) {
        this.cancelFile(incoming.offer.id);
        this.notify("Incoming file was larger than advertised and was rejected.");
        return;
      }
      if (incoming.writer) {
        await incoming.writer.write(data);
      } else {
        incoming.chunks.push(data);
      }
      incoming.bytes += data.byteLength;
      this.editTransfer(incoming.offer.id, { bytes: incoming.bytes });
      if (incoming.bytes - incoming.acknowledged >= ACK_INTERVAL || incoming.bytes === incoming.offer.size) {
        incoming.acknowledged = incoming.bytes;
        this.sendControl({ type: "file-ack", id: incoming.offer.id, bytes: incoming.bytes });
      }
    }).catch((error: unknown) => {
      this.cancelFile(incoming.offer.id);
      this.notify(`Could not save the incoming file: ${displayError(error)}`);
    });
  }

  private finishIncoming(id: string) {
    const incoming = this.incoming;
    if (!incoming || incoming.offer.id !== id) return;
    incoming.chain = incoming.chain.then(async () => {
      if (incoming.cancelled) return;
      if (incoming.bytes !== incoming.offer.size) {
        this.cancelFile(id);
        this.notify("File ended before all its bytes arrived. Ask the sender to try again.");
        return;
      }
      if (incoming.writer) {
        await incoming.writer.close();
        this.editTransfer(id, { status: "saved", bytes: incoming.bytes });
      } else {
        const blob = new Blob(incoming.chunks, { type: incoming.offer.mime || "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        this.urls.add(url);
        this.editTransfer(id, { status: "completed", bytes: incoming.bytes, url });
      }
      incoming.chunks = [];
      if (this.incoming === incoming) this.incoming = null;
      this.sendControl({ type: "file-received", id });
    }).catch((error: unknown) => {
      this.cancelFile(id);
      this.notify(`Could not finish saving the file: ${displayError(error)}`);
    });
  }

  private handleControl(raw: string) {
    if (raw.length > 24_000) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!data || typeof data.type !== "string") return;
    const id = typeof data.id === "string" ? data.id.slice(0, 80) : "";

    switch (data.type) {
      case "text":
        if (!id || typeof data.text !== "string" || !data.text.trim() || data.text.length > MAX_TEXT_CHARS) return;
        this.update({
          texts: [...this.snapshot.texts, { id, text: data.text, fromMe: false, time: Date.now(), delivered: true }],
        });
        this.sendControl({ type: "text-received", id });
        break;
      case "text-received":
        this.update({ texts: this.snapshot.texts.map((text) => text.id === id ? { ...text, delivered: true } : text) });
        break;
      case "file-offer": {
        if (
          !id || typeof data.name !== "string" || typeof data.size !== "number" ||
          !Number.isSafeInteger(data.size) || data.size < 0 || data.size > MAX_FILE_BYTES ||
          this.incoming || this.snapshot.incomingOffer
        ) {
          this.sendControl({ type: "file-decline", id });
          return;
        }
        const offer: FileOffer = {
          id,
          name: safeName(data.name),
          size: data.size,
          mime: typeof data.mime === "string" ? data.mime.slice(0, 128) : "",
        };
        this.update({
          incomingOffer: offer,
          transfers: [{ ...offer, bytes: 0, direction: "incoming", status: "awaiting" }, ...this.snapshot.transfers],
        });
        break;
      }
      case "file-accept":
        if (this.outgoing?.id === id) void this.pumpFile(this.outgoing);
        break;
      case "file-decline":
        if (this.outgoing?.id === id) {
          this.outgoing.cancelled = true;
          this.outgoing = null;
          this.editTransfer(id, { status: "declined" });
          this.processQueue();
        }
        break;
      case "file-ack":
        if (this.outgoing?.id === id && typeof data.bytes === "number") {
          this.outgoing.acked = Math.max(this.outgoing.acked, Math.min(this.outgoing.file.size, data.bytes));
        }
        break;
      case "file-complete":
        this.finishIncoming(id);
        break;
      case "file-received":
        if (this.outgoing?.id === id) {
          this.editTransfer(id, { status: "completed", bytes: this.outgoing.file.size });
          this.outgoing = null;
          this.processQueue();
        }
        break;
      case "file-cancel":
        if (this.snapshot.incomingOffer?.id === id) {
          this.update({ incomingOffer: null });
          this.editTransfer(id, { status: "cancelled" });
        } else if (this.incoming?.offer.id === id) {
          const incoming = this.incoming;
          incoming.cancelled = true;
          this.incoming = null;
          if (incoming.writer) void incoming.writer.abort().catch(() => {});
          this.editTransfer(id, { status: "cancelled" });
        } else if (this.outgoing?.id === id) {
          this.outgoing.cancelled = true;
          this.outgoing = null;
          this.editTransfer(id, { status: "cancelled" });
          this.processQueue();
        }
        break;
      default:
        break;
    }
  }
}