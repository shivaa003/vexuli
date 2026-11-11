import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  File,
  FileText,
  FolderUp,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Send,
  ShieldCheck,
  Smartphone,
  Timer,
  WifiOff,
  X,
} from "lucide-react";
import type { TransferEngine, TransferState, TransferView } from "@/lib/transfer";
import { MAX_FILE_BYTES, MAX_TEXT_CHARS } from "@/lib/transfer";
import { cn } from "@/utils/cn";

type Props = {
  engine: TransferEngine;
  state: TransferState;
  mode: "create" | "join";
  onModeChange: (mode: "create" | "join") => void;
};

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit === 1 ? 0 : 1)} ${["B", "KB", "MB", "GB"][unit]}`;
}

function useCountdown(expiresAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  if (!expiresAt) return "05:00";
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function InlineAlert({ message, close }: { message: string; close: () => void }) {
  return (
    <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-flare-400/25 bg-flare-400/[0.09] px-4 py-3.5 text-[13px] leading-relaxed text-flare-300">
      <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-flare-400" />
      <span className="flex-1">{message}</span>
      <button type="button" aria-label="Dismiss message" onClick={close} className="shrink-0 rounded p-0.5 text-flare-300 transition-colors hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function ActionButton({ children, onClick, disabled, secondary = false, className = "" }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl px-5 py-3 text-[13.5px] font-semibold transition-all duration-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45",
        secondary
          ? "border border-slate-300 bg-slate-100 text-slate-800 hover:border-slate-400 hover:bg-slate-200 dark:border-white/14 dark:bg-white/[0.05] dark:text-white dark:hover:border-white/30 dark:hover:bg-white/[0.09]"
          : "bg-signal-400 text-ink-950 shadow-[0_15px_35px_-17px_rgba(53,228,193,0.8)] hover:-translate-y-0.5 hover:bg-signal-300",
        className,
      )}
    >
      {children}
    </button>
  );
}

function TransferRow({ item, engine }: { item: TransferView; engine: TransferEngine }) {
  const done = item.status === "completed" || item.status === "saved";
  const active = ["queued", "awaiting", "sending", "receiving", "finalizing"].includes(item.status);
  const value = item.size === 0 ? 100 : Math.round(item.bytes / item.size * 100);
  const label: Record<TransferView["status"], string> = {
    queued: "Queued",
    awaiting: item.direction === "outgoing" ? "Waiting for acceptance" : "Awaiting your choice",
    sending: "Sending",
    receiving: "Receiving",
    finalizing: "Finishing on other device",
    completed: item.direction === "incoming" ? "Ready to download" : "Received",
    saved: "Saved on this device",
    declined: "Declined",
    cancelled: "Cancelled",
    failed: "Interrupted",
  };

  return (
    <li className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-3.5 transition-colors hover:border-slate-300 dark:border-white/8 dark:bg-white/[0.035] dark:hover:border-white/15 sm:p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", done ? "bg-signal-400/15 text-signal-600 dark:bg-signal-400/12 dark:text-signal-300" : "bg-slate-200/70 text-slate-600 dark:bg-white/[0.07] dark:text-ink-300")}>
          {done ? <Check className="h-[19px] w-[19px]" /> : <File className="h-[19px] w-[19px]" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-white" title={item.name}>{item.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-ink-400">
            {item.direction === "outgoing" ? "Sent" : "Received"} | {formatBytes(item.size)} | {label[item.status]}
          </p>
        </div>
        {item.url ? (
          <span className="flex shrink-0 items-center gap-1">
            <a
              href={item.url}
              download={item.name}
              aria-label={`Download ${item.name}`}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-signal-400/12 px-3 text-[11.5px] font-semibold text-signal-300 transition-colors hover:bg-signal-400/25"
            >
              <Download className="h-3.5 w-3.5" /> Save
            </a>
            <button
              type="button"
              onClick={() => engine.releaseDownload(item.id)}
              aria-label={`Remove local copy of ${item.name} after saving`}
              title="Remove from this tab after saving"
              className="grid h-9 w-7 place-items-center rounded-lg text-ink-400 transition-colors hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : active && item.status !== "awaiting" ? (
          <button type="button" onClick={() => engine.cancelFile(item.id)} aria-label={`Cancel ${item.name}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-white/8 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        ) : done ? (
          <CheckCheck className="h-4 w-4 shrink-0 text-signal-400" />
        ) : null}
      </div>
      {(item.status === "sending" || item.status === "receiving" || item.status === "finalizing") && (
        <div className="mt-3 flex items-center gap-3">
          <div
            role="progressbar"
            aria-label={`${item.name} transfer progress`}
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8"
          >
            <div className="h-full rounded-full bg-gradient-to-r from-signal-500 to-sky-beam transition-[width] duration-200" style={{ width: `${value}%` }} />
          </div>
          <span className="w-9 text-right font-mono text-[10.5px] text-signal-300">{value}%</span>
        </div>
      )}
    </li>
  );
}

function Connected({ engine, state }: Pick<Props, "engine" | "state">) {
  const [tab, setTab] = useState<"files" | "text">("files");
  const [text, setText] = useState("");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === "text") threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state.texts.length, tab]);

  const send = () => {
    if (engine.sendText(text)) setText("");
  };

  return (
    <div className="animate-[pop-in_0.5s_cubic-bezier(0.16,1,0.3,1)_both]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 pb-5 dark:border-white/8">
        <div className="flex items-start gap-3">
          <span className="relative mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-signal-400/15 text-signal-600 dark:bg-signal-400/12 dark:text-signal-300">
            <span className="absolute inset-0 animate-ping rounded-xl border border-signal-400/25 [animation-duration:3s]" />
            <ShieldCheck className="relative h-5 w-5" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-slate-900 dark:text-white">Secure channel open</p>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-ink-400">
              Connected to {state.peerLabel || "the other device"}
              {state.connectionRoute === "relay" ? " | encrypted TURN relay" : state.connectionRoute === "direct" ? " | direct connection" : ""}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => engine.leave()} className="rounded-full border border-slate-300 bg-slate-100 px-3.5 py-2 text-[11.5px] font-medium text-slate-700 transition-all hover:border-flare-400/45 hover:text-flare-400 dark:border-white/12 dark:bg-transparent dark:text-ink-300 dark:hover:border-flare-400/45 dark:hover:text-flare-300">
          End session
        </button>
      </div>

      {state.reconnecting && (
        <div role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-flare-400/25 bg-flare-400/8 px-3 py-2.5 text-[12px] text-flare-300">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Connection interrupted. Waiting for it to recover.
        </div>
      )}

      {state.incomingOffer && (
        <div className="mt-5 rounded-2xl border border-signal-400/35 bg-signal-400/[0.09] p-4" role="region" aria-label="Incoming file request">
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.15em] text-signal-300 uppercase"><FolderUp className="h-4 w-4" /> Incoming file</p>
          <p className="mt-2 truncate text-[14px] font-semibold text-white" title={state.incomingOffer.name}>{state.incomingOffer.name}</p>
          <p className="mt-1 text-[12px] text-ink-300">{formatBytes(state.incomingOffer.size)} | You choose whether to accept it.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => void engine.acceptFile()} className="min-h-[40px] py-2">Accept &amp; save <Download className="h-3.5 w-3.5" /></ActionButton>
            <ActionButton onClick={() => engine.declineFile()} secondary className="min-h-[40px] py-2">Decline</ActionButton>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-400">On supported browsers you choose a save location first. Elsewhere, use the download link when it arrives.</p>
        </div>
      )}

      <div className="mt-5 flex rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-white/10 dark:bg-ink-950/55" role="tablist" aria-label="Transfer type">
        {([
          { id: "files", label: "Files", icon: File },
          { id: "text", label: "Text", icon: FileText },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "flex min-h-[39px] flex-1 items-center justify-center gap-2 rounded-lg text-[12.5px] font-semibold transition-all",
              tab === id
                ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                : "text-slate-500 hover:text-slate-900 dark:text-ink-400 dark:hover:text-white",
            )}
          >
            <Icon className="h-4 w-4" /> {label}
            {id === "files" && state.transfers.length > 0 && <span className="rounded-full bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-white/10 dark:text-white">{state.transfers.length}</span>}
          </button>
        ))}
      </div>

      {tab === "files" ? (
        <div role="tabpanel" aria-label="File transfers" className="mt-4">
          <input
            ref={picker}
            type="file"
            multiple
            aria-label="Choose files to send"
            className="sr-only"
            onChange={(event) => {
              engine.queueFiles(Array.from(event.target.files || []));
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              engine.queueFiles(Array.from(event.dataTransfer.files));
            }}
            className={cn(
              "group flex min-h-[134px] w-full flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-6 text-center transition-all duration-300",
              dragging
                ? "border-signal-500 bg-signal-500/10 dark:border-signal-400 dark:bg-signal-400/12"
                : "border-slate-300 bg-slate-50/60 hover:border-signal-500/60 hover:bg-signal-50/40 dark:border-white/20 dark:bg-white/[0.025] dark:hover:border-signal-400/55 dark:hover:bg-signal-400/[0.045]",
            )}
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-signal-400/15 text-signal-600 transition-transform duration-300 group-hover:-translate-y-1 dark:bg-signal-400/10 dark:text-signal-300"><FolderUp className="h-5 w-5" /></span>
            <span className="mt-2.5 text-[13px] font-semibold text-slate-900 dark:text-white">Choose files or drop them here</span>
            <span className="mt-1 text-[11px] text-slate-500 dark:text-ink-400">Any file type | up to {formatBytes(MAX_FILE_BYTES)} each | 20 at a time</span>
          </button>
          {state.transfers.length > 0 && (
            <div className="mt-5">
              <div className="mb-2.5 flex items-center justify-between text-[10.5px] font-medium tracking-[0.14em] text-ink-400 uppercase"><span>Transfer activity</span><span>Newest first</span></div>
              <ul className="max-h-[350px] space-y-2 overflow-y-auto pr-1">
                {state.transfers.map((item) => <TransferRow key={item.id} item={item} engine={engine} />)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="Text transfers" className="mt-4">
          {state.texts.length > 0 ? (
            <div className="max-h-56 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/8 dark:bg-ink-950/45" aria-live="polite">
              {state.texts.map((entry) => (
                <div key={entry.id} className={cn("max-w-[93%] rounded-xl border px-3.5 py-3", entry.fromMe ? "ml-auto border-signal-500/30 bg-signal-50/80 text-slate-900 dark:border-signal-400/20 dark:bg-signal-400/[0.07] dark:text-white" : "mr-auto border-slate-200 bg-white text-slate-900 shadow-sm dark:border-white/10 dark:bg-white/[0.045] dark:text-white")}>
                  <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500 dark:text-ink-400">
                    <span>{entry.fromMe ? "You" : state.peerLabel || "Other device"} | {new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    {entry.fromMe && <span>{entry.delivered ? "Received" : "Sending"}</span>}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-slate-900 dark:text-white">{entry.text}</p>
                  {!entry.fromMe && (
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(entry.text).then(() => {
                          setCopiedText(entry.id);
                          setTimeout(() => setCopiedText(null), 2000);
                        }).catch(() => {
                          setCopyFailed(true);
                          setTimeout(() => setCopyFailed(false), 4000);
                        });
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-signal-600 transition-colors hover:text-signal-700 dark:text-signal-300 dark:hover:text-signal-200"
                    >
                      {copiedText === entry.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedText === entry.id ? "Copied" : "Copy text"}
                    </button>
                  )}
                </div>
              ))}
              <div ref={threadEnd} />
            </div>
          ) : (
            <div className="flex h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/60 text-slate-500 dark:border-white/8 dark:bg-ink-950/45 dark:text-ink-400">
              <Clipboard className="h-5 w-5" />
              <p className="text-[12px]">Text you send appears on both devices here.</p>
            </div>
          )}
          {copyFailed && <p role="status" className="mt-2 text-[11px] text-flare-400">Clipboard access is unavailable. Select the text and copy it manually.</p>}
          <label htmlFor="text-composer" className="mt-4 block text-[11px] font-semibold tracking-[0.13em] text-slate-600 uppercase dark:text-ink-400">Send plain text</label>
          <textarea
            id="text-composer"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                send();
              }
            }}
            maxLength={MAX_TEXT_CHARS}
            rows={4}
            placeholder="Paste a note, link, address or code. Ctrl/Cmd + Enter to send."
            className="mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-[13px] leading-relaxed text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-signal-500 dark:border-white/12 dark:bg-ink-950/55 dark:text-white dark:placeholder:text-ink-400 dark:focus:border-signal-400/55"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="font-mono text-[10.5px] text-slate-500 dark:text-ink-400">{text.length} / {MAX_TEXT_CHARS}</span>
            <ActionButton onClick={send} disabled={!text.trim()} className="min-h-[39px] py-2">Send text <Send className="h-3.5 w-3.5" /></ActionButton>
          </div>
        </div>
      )}

      <p className="mt-5 flex items-center gap-2 border-t border-slate-200/80 pt-4 text-[11px] leading-relaxed text-slate-500 dark:border-white/8 dark:text-ink-400">
        <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-signal-600 dark:text-signal-400" />
        Content travels over an encrypted WebRTC connection. Keep both pages open until the transfer finishes.
      </p>
    </div>
  );
}

export default function TransferWorkspace({ engine, state, mode, onModeChange }: Props) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [copied, setCopied] = useState(false);
  const [codeCopyFailed, setCodeCopyFailed] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const remaining = useCountdown(state.expiresAt);
  const supported = typeof RTCPeerConnection !== "undefined" && typeof WebSocket !== "undefined";
  const codeReady = digits.every((digit) => digit.length === 1);

  const fill = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "").slice(0, 4 - index);
    const next = [...digits];
    if (!clean) {
      next[index] = "";
    } else {
      clean.split("").forEach((digit, i) => { next[index + i] = digit; });
      inputs.current[Math.min(3, index + clean.length)]?.focus();
    }
    setDigits(next);
  };

  const copyCode = async () => {
    if (!state.code) return;
    try {
      await navigator.clipboard.writeText(state.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCodeCopyFailed(true);
      setTimeout(() => setCodeCopyFailed(false), 4000);
    }
  };

  const busy = ["creating", "joining"].includes(state.phase);
  const inRoom = ["waiting", "requesting", "approval", "connecting", "connected"].includes(state.phase);

  return (
    <div id="transfer" className="relative scroll-mt-24">
      <div className="pointer-events-none absolute -inset-3 rounded-[30px] bg-signal-400/7 blur-2xl" />
      <div className="relative overflow-hidden rounded-[24px] border border-slate-200/90 bg-white/95 p-4 shadow-[0_24px_70px_-25px_rgba(15,23,42,0.10)] backdrop-blur-2xl transition-colors duration-300 dark:border-white/13 dark:bg-[#0a1220]/93 dark:shadow-[0_36px_90px_-35px_rgba(0,0,0,0.86)] sm:p-6">
        <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-signal-400/50 to-transparent" />
        <div className="relative flex items-center justify-between gap-3 border-b border-slate-200/80 pb-4 dark:border-white/8">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-signal-400/15 text-signal-600 dark:bg-signal-400/10 dark:text-signal-300"><Link2 className="h-[18px] w-[18px]" /></span>
            <div>
              <p className="font-display text-[14px] font-bold text-slate-900 dark:text-white">Transfer space</p>
              <p className="font-mono text-[10px] tracking-wide text-slate-500 dark:text-ink-400">vexuli / live session</p>
            </div>
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-mono text-[10px]", state.phase === "connected" ? "border-signal-500/30 bg-signal-50 text-signal-700 dark:border-signal-400/30 dark:bg-signal-400/10 dark:text-signal-300" : state.serverOnline === false ? "border-flare-400/30 bg-flare-50 text-flare-700 dark:border-flare-400/25 dark:bg-flare-400/8 dark:text-flare-300" : "border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-ink-300") }>
            <span className={cn("h-1.5 w-1.5 rounded-full", state.phase === "connected" ? "bg-signal-500 dark:bg-signal-400" : state.serverOnline === false ? "bg-flare-500 dark:bg-flare-400" : "bg-signal-500 dark:bg-signal-400 animate-pulse")} />
            {state.phase === "connected" ? "Connected" : state.serverOnline === false ? "Server offline" : state.serverOnline === null ? "Checking" : "Server online"}
          </span>
        </div>

        <div className="relative pt-5">
          {state.message && <InlineAlert message={state.message} close={() => engine.dismissMessage()} />}

          {!supported && (
            <div className="mb-5 flex gap-3 rounded-xl border border-flare-400/30 bg-flare-50 p-3.5 text-[12px] leading-relaxed text-flare-700 dark:border-flare-400/25 dark:bg-flare-400/8 dark:text-flare-300">
              <WifiOff className="h-4 w-4 shrink-0" /> This browser does not support WebRTC data channels. Please use a current version of Chrome, Safari, Firefox or Edge.
            </div>
          )}

          {!inRoom && (
            <div className="animate-[pop-in_0.45s_cubic-bezier(0.16,1,0.3,1)_both]">
              {state.phase === "ended" && (
                <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] leading-relaxed text-slate-600 dark:border-white/10 dark:bg-white/[0.035] dark:text-ink-300">
                  Session ended. Completed downloads below remain available until you start a new session or close this page.
                </div>
              )}
              <div role="tablist" aria-label="Pairing mode" className="flex rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-white/10 dark:bg-ink-950/60">
                {([
                  { key: "create", label: "Create a room" },
                  { key: "join", label: "Join with code" },
                ] as const).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={mode === item.key}
                    onClick={() => onModeChange(item.key)}
                    className={cn("min-h-[40px] flex-1 rounded-lg text-[12.5px] font-semibold transition-all duration-300", mode === item.key ? "bg-white text-slate-900 shadow-sm dark:bg-white/[0.11] dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.11)]" : "text-slate-500 hover:text-slate-900 dark:text-ink-400 dark:hover:text-white")}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {mode === "create" ? (
                <div role="tabpanel" className="py-7 text-center sm:py-8">
                  <div className="relative mx-auto grid h-[74px] w-[74px] place-items-center rounded-[23px] border border-signal-500/25 bg-signal-500/[0.08] text-signal-600 dark:border-signal-400/20 dark:bg-signal-400/[0.075] dark:text-signal-300">
                    <span className="absolute -inset-2 rounded-[29px] border border-signal-500/10 dark:border-signal-400/8" />
                    <Smartphone className="h-7 w-7" />
                    <span className="absolute -right-2 -bottom-1 grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-signal-600 shadow-sm dark:border-ink-800 dark:bg-ink-900 dark:text-signal-300"><Link2 className="h-3.5 w-3.5" /></span>
                  </div>
                  <h2 className="mt-6 font-display text-[clamp(1.25rem,2vw,1.55rem)] font-bold text-slate-900 dark:text-white">Two screens. One private room.</h2>
                  <p className="mx-auto mt-2.5 max-w-[34ch] text-[13px] leading-relaxed text-slate-600 dark:text-ink-300">Generate a one-time code, share it with the other device, then approve the connection.</p>
                  <ActionButton onClick={() => void engine.createRoom()} disabled={busy || !supported} className="mt-7 w-full max-w-[290px]">
                    {busy ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Creating your room</> : <>Generate a 4-digit code <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
                  </ActionButton>
                  <p className="mt-4 text-[11px] text-slate-500 dark:text-ink-400">No account | no upload | expires in five minutes</p>
                </div>
              ) : (
                <div role="tabpanel" className="py-7 sm:py-8">
                  <div className="mx-auto max-w-[320px] text-center">
                    <h2 className="font-display text-[clamp(1.25rem,2vw,1.55rem)] font-bold text-slate-900 dark:text-white">Have a code?</h2>
                    <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-ink-300">Enter the four digits shown on the other device.</p>
                    <div role="group" aria-label="Four digit room code" className="mt-6 grid grid-cols-4 gap-2.5">
                      {digits.map((digit, index) => (
                        <input
                          key={index}
                          ref={(node) => { inputs.current[index] = node; }}
                          aria-label={`Code digit ${index + 1}`}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={4}
                          value={digit}
                          onChange={(event) => fill(index, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Backspace" && !digit && index > 0) inputs.current[index - 1]?.focus();
                            if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
                            if (event.key === "ArrowRight" && index < 3) inputs.current[index + 1]?.focus();
                            if (event.key === "Enter" && codeReady) void engine.joinRoom(digits.join(""));
                          }}
                          onPaste={(event) => {
                            const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
                            if (pasted.length >= 2) {
                              event.preventDefault();
                              setDigits([0, 1, 2, 3].map((i) => pasted[i] || ""));
                              inputs.current[Math.min(3, pasted.length)]?.focus();
                            }
                          }}
                          placeholder="-"
                          className="h-16 w-full rounded-xl border border-slate-300 bg-slate-50 text-center font-mono text-[2rem] font-semibold text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-signal-500 focus:bg-white dark:border-white/14 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-ink-600 dark:focus:border-signal-400/65 dark:focus:bg-signal-400/[0.07]"
                        />
                      ))}
                    </div>
                    <ActionButton onClick={() => void engine.joinRoom(digits.join(""))} disabled={!codeReady || busy || !supported} className="mt-5 w-full">
                      {busy ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Finding room</> : <>Request to connect <ChevronRight className="h-4 w-4" /></>}
                    </ActionButton>
                    <p className="mt-4 text-[11px] leading-relaxed text-slate-500 dark:text-ink-400">The person who created the room must approve you before anything can be sent.</p>
                  </div>
                </div>
              )}

              {state.phase === "ended" && state.transfers.some((item) => item.url) && (
                <div className="border-t border-slate-200 pt-4 dark:border-white/8">
                  <p className="mb-3 text-[11px] font-semibold tracking-widest text-slate-500 uppercase dark:text-ink-400">Your completed downloads</p>
                  <ul className="space-y-2">{state.transfers.filter((item) => item.url).map((item) => <TransferRow key={item.id} item={item} engine={engine} />)}</ul>
                </div>
              )}
            </div>
          )}


          {state.phase === "waiting" && state.code && (
            <div className="animate-[pop-in_0.45s_cubic-bezier(0.16,1,0.3,1)_both] py-3 text-center">
              <p className="font-mono text-[10.5px] tracking-[0.18em] text-slate-500 uppercase dark:text-ink-400">Your one-time room code</p>
              <div aria-label={`Your room code is ${state.code.split("").join(" ")}`} className="mt-5 grid grid-cols-4 gap-2.5">
                {state.code.split("").map((digit, index) => (
                  <span key={index} aria-hidden className="grid h-[72px] place-items-center rounded-xl border border-signal-500/30 bg-gradient-to-b from-signal-500/[0.09] to-signal-500/[0.02] font-mono text-[2.4rem] font-semibold text-slate-900 shadow-sm dark:border-signal-400/30 dark:bg-gradient-to-b dark:from-signal-400/[0.11] dark:to-signal-400/[0.035] dark:text-white sm:h-[82px] sm:text-[2.7rem]">{digit}</span>
                ))}
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-slate-600 dark:text-ink-300">Give these digits to the other device. Keep this page open.</p>
              <div className="mt-5 flex justify-center gap-2">
                <ActionButton onClick={() => void copyCode()}><Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy code"}</ActionButton>
                <ActionButton onClick={() => engine.leave()} secondary>Cancel</ActionButton>
              </div>
              {codeCopyFailed && <p role="status" className="mt-2 text-[11px] text-flare-500 dark:text-flare-300">Clipboard unavailable. You can read the code aloud.</p>}
              <div className="mt-7 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] text-slate-700 dark:border-white/8 dark:bg-ink-950/55 dark:text-ink-300">
                <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal-500 dark:bg-signal-400" /> Waiting for the other device</span>
                <span className="flex shrink-0 items-center gap-1.5 font-mono text-flare-600 dark:text-flare-300"><Timer className="h-3.5 w-3.5" /> {remaining}</span>
              </div>
            </div>
          )}

          {state.phase === "requesting" && (
            <div className="animate-[pop-in_0.45s_cubic-bezier(0.16,1,0.3,1)_both] py-7 text-center">
              <LoaderCircle className="mx-auto h-9 w-9 animate-spin text-signal-500 dark:text-signal-400" />
              <h2 className="mt-5 font-display text-[1.45rem] font-bold text-slate-900 dark:text-white">Waiting for approval</h2>
              <p className="mx-auto mt-2 max-w-[38ch] text-[13px] leading-relaxed text-slate-600 dark:text-ink-300">The person on {state.peerLabel || "the other device"} must approve your connection.</p>
              <Phrase phrase={state.phrase} />
              <p className="mt-4 text-[11.5px] text-slate-500 dark:text-ink-400">Read this phrase to them through a separate channel to confirm it's really you.</p>
              <ActionButton onClick={() => engine.leave()} secondary className="mt-6">Cancel request</ActionButton>
            </div>
          )}

          {state.phase === "approval" && (
            <div className="animate-[pop-in_0.45s_cubic-bezier(0.16,1,0.3,1)_both] py-6 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-signal-500/25 bg-signal-500/[0.08] text-signal-600 dark:border-signal-400/25 dark:bg-signal-400/[0.08] dark:text-signal-300"><Smartphone className="h-6 w-6" /></span>
              <h2 className="mt-5 font-display text-[1.45rem] font-bold text-slate-900 dark:text-white">Someone wants to join</h2>
              <p className="mt-2 text-[13px] text-slate-600 dark:text-ink-300">{state.peerLabel || "Another browser"} entered your code.</p>
              <Phrase phrase={state.phrase} />
              <p className="mx-auto mt-4 max-w-[40ch] text-[12px] leading-relaxed text-slate-600 dark:text-ink-300">Ask the person you're connecting with to read this phrase back to you before approving. The browser name alone is not proof of identity.</p>
              <div className="mt-6 flex justify-center gap-2">
                <ActionButton onClick={() => engine.approve()}><Check className="h-4 w-4" /> Approve device</ActionButton>
                <ActionButton onClick={() => engine.reject()} secondary>Decline</ActionButton>
              </div>
            </div>
          )}

          {state.phase === "connecting" && (
            <div role="status" className="py-10 text-center">
              <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-signal-500/10 text-signal-600 dark:bg-signal-400/10 dark:text-signal-300"><span className="absolute inset-0 animate-ping rounded-2xl border border-signal-500/25 dark:border-signal-400/25 [animation-duration:2s]" /><LockKeyhole className="relative h-7 w-7" /></span>
              <h2 className="mt-6 font-display text-[1.45rem] font-bold text-slate-900 dark:text-white">Connecting the devices</h2>
              <p className="mx-auto mt-2 max-w-[35ch] text-[13px] leading-relaxed text-slate-600 dark:text-ink-300">Negotiating an encrypted WebRTC data channel. This can take a few seconds across networks.</p>
              <ActionButton onClick={() => engine.leave()} secondary className="mt-6">Cancel connection</ActionButton>
            </div>
          )}

          {state.phase === "connected" && <Connected engine={engine} state={state} />}
        </div>
      </div>
    </div>
  );
}

function Phrase({ phrase }: { phrase: string | null }) {
  return (
    <div className="mx-auto mt-5 max-w-[340px] rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 dark:border-white/12 dark:bg-ink-950/70">
      <p className="font-mono text-[10px] tracking-[0.15em] text-slate-500 uppercase dark:text-ink-400">Pairing phrase</p>
      <p className="mt-1.5 font-mono text-[15px] font-semibold tracking-[0.04em] text-signal-600 dark:text-signal-300">{phrase || "..."}</p>
    </div>
  );
}
