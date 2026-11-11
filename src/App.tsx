import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  FileText,
  KeyRound,
  LockKeyhole,
  Menu,
  Radio,
  Send,
  ShieldCheck,
  Smartphone,
  Wifi,
  X,
} from "lucide-react";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import Backdrop from "@/components/Backdrop";
import { ThemeToggle } from "@/components/ThemeToggle";
import TransferWorkspace from "@/components/TransferWorkspace";
import { Logo, Reveal } from "@/components/ui";
import { TransferEngine } from "@/lib/transfer";
import { cn } from "@/utils/cn";

const links = [
  { label: "Transfer", href: "#transfer" },
  { label: "Analytics", href: "#analytics" },
  { label: "How it works", href: "#how" },
  { label: "Privacy", href: "#privacy" },
  { label: "Questions", href: "#questions" },
];

const questions = [
  {
    q: "Does Vexuli upload or store my files?",
    a: "No. A small signaling server matches browsers using the code and exchanges WebRTC connection details. File bytes and text travel over an encrypted WebRTC data channel, not through the signaling server. If the direct connection cannot be made and TURN is configured, a TURN server forwards encrypted packets without storing your file.",
  },
  {
    q: "Is a four-digit code enough to keep a transfer private?",
    a: "The code is a temporary room address, not an encryption password. Codes are unique among active rooms, expire after five minutes before pairing, and joins are rate-limited. The room creator must approve the request. Compare the pairing phrase on both devices through a separate channel before approving someone. WebRTC encrypts the connection itself.",
  },
  {
    q: "Does this work on different networks and in different countries?",
    a: "Yes, when WebRTC can establish a connection. Many networks allow a direct connection. Restrictive firewalls or carrier NAT can require a TURN relay. Configure TURN on the deployment for dependable cross-network access; the app warns when no relay is configured.",
  },
  {
    q: "How large a file can I send?",
    a: "Each file can be up to 100 MB, and you can queue up to 20 files at a time. The limit keeps the browser download fallback manageable on Safari and Firefox. On supporting browsers you choose a save location and the file streams directly to disk. Text is limited to 4,000 characters; for longer text, send a .txt file.",
  },
  {
    q: "What if I close the page during a transfer?",
    a: "The live channel closes and unfinished transfers stop. Keep both pages awake and open until a file says Received or Saved. Completed downloads remain available while the receiving page stays open. Transfers do not resume after a disconnected session.",
  },
  {
    q: "Can both devices send files and text?",
    a: "Yes. Once the room is approved, both devices can offer files and send plain text. The recipient chooses whether to accept each incoming file. Text appears on both devices and can be copied to the clipboard. Neither device needs an account.",
  },
];

function Eyebrow({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[10.5px] font-medium tracking-[0.22em] uppercase",
        light ? "text-signal-600 dark:text-signal-400" : "text-signal-600 dark:text-signal-300",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-signal-500 dark:bg-signal-400" /> {children}
    </p>
  );
}

function Header({
  onJoin,
  online,
}: {
  onJoin: () => void;
  online: boolean | null;
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-all duration-300",
        scrolled || open
          ? "border-slate-200/90 bg-white/90 shadow-sm backdrop-blur-2xl dark:border-white/10 dark:bg-ink-950/90 dark:shadow-[0_12px_50px_-30px_rgba(0,0,0,0.8)]"
          : "border-transparent bg-transparent",
      )}
    >
      <nav
        className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-5 px-5 sm:px-8"
        aria-label="Main navigation"
      >
        <Logo />

        <div className="hidden items-center gap-8 lg:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[13px] font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-ink-300 dark:hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Theme Toggle Button */}
          <ThemeToggle />

          {online === false && (
            <span className="hidden items-center gap-1.5 font-mono text-[10.5px] text-flare-600 sm:inline-flex dark:text-flare-300">
              <span className="h-1.5 w-1.5 rounded-full bg-flare-500" /> Server offline
            </span>
          )}

          <button
            type="button"
            onClick={onJoin}
            className="group hidden min-h-[40px] items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-white dark:text-ink-950 dark:hover:bg-signal-400 sm:inline-flex"
          >
            Join with a code{" "}
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-300 bg-white text-slate-800 shadow-sm transition-colors hover:bg-slate-100 dark:border-white/12 dark:bg-white/[0.04] dark:text-white lg:hidden"
          >
            {open ? <X className="h-[19px] w-[19px]" /> : <Menu className="h-[19px] w-[19px]" />}
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {open && (
        <div
          id="mobile-nav"
          className="animate-[pop-in_0.25s_ease-out] border-t border-slate-200 bg-white/98 px-5 pb-6 pt-3 shadow-xl backdrop-blur-2xl dark:border-white/8 dark:bg-ink-950/98 lg:hidden"
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="flex min-h-[49px] items-center justify-between border-b border-slate-100 text-[14px] font-medium text-slate-700 dark:border-white/8 dark:text-ink-200"
            >
              {link.label}
              <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 dark:text-ink-400" />
            </a>
          ))}

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onJoin();
              }}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-signal-400 text-[13px] font-bold text-ink-950 shadow-md"
            >
              Join with a code <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

function HowItWorks() {
  const steps = [
    {
      number: "01",
      icon: KeyRound,
      title: "Create a room",
      body: "Open Vexuli on one device and generate a unique four-digit code. It waits for five minutes and is then retired.",
    },
    {
      number: "02",
      icon: Smartphone,
      title: "Connect the other device",
      body: "Enter the code on a second browser. Compare the pairing phrase, then approve the request on the first device.",
    },
    {
      number: "03",
      icon: Send,
      title: "Send what you need",
      body: "Drop files or send plain text in either direction. The recipient accepts each file and saves it locally.",
    },
  ];

  return (
    <section id="how" className="relative scroll-mt-24 border-t border-slate-200/80 py-22 transition-colors duration-300 dark:border-white/8 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <Reveal>
          <Eyebrow>One room, two devices</Eyebrow>
          <h2 className="mt-5 max-w-[18ch] text-[clamp(2.2rem,5vw,3.6rem)] font-bold text-slate-900 dark:text-white text-balance">
            The whole process, without the usual detours.
          </h2>
          <p className="mt-5 max-w-[62ch] text-[15px] leading-relaxed text-slate-600 dark:text-ink-300">
            No accounts or installation on either device. The code finds the room, you approve the person, and the
            browsers handle the transfer.
          </p>
        </Reveal>

        <div className="mt-13 grid gap-8 border-t border-slate-200 pt-9 dark:border-white/12 md:grid-cols-3 md:gap-10">
          {steps.map(({ number, icon: Icon, title, body }, index) => (
            <Reveal key={number} delay={index * 100}>
              <article className="pr-2">
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl border border-signal-500/20 bg-signal-500/[0.08] text-signal-600 dark:border-signal-400/20 dark:bg-signal-400/[0.07] dark:text-signal-300">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 dark:text-ink-400">/{number}</span>
                </div>
                <h3 className="mt-6 text-[1.35rem] font-bold text-slate-900 dark:text-white">{title}</h3>
                <p className="mt-3 max-w-[36ch] text-[13.5px] leading-[1.75] text-slate-600 dark:text-ink-300">{body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Privacy() {
  const rows = [
    {
      icon: KeyRound,
      label: "Signaling server",
      description:
        "Temporary room code, browser label and connection details. Rooms live in memory and are removed when the session ends.",
    },
    {
      icon: Radio,
      label: "Between the browsers",
      description:
        "File bytes and text over a WebRTC data channel encrypted with DTLS. A configured TURN server may relay encrypted packets in transit.",
    },
    {
      icon: FileText,
      label: "On your device",
      description:
        "The recipient chooses whether to accept a file. It is saved locally or offered as a browser download, never as a server-side link.",
    },
  ];

  return (
    <section
      id="privacy"
      className="relative scroll-mt-24 overflow-hidden border-t border-slate-200/80 bg-slate-50 py-22 text-slate-900 transition-colors duration-300 dark:border-white/8 dark:bg-ink-900/60 dark:text-white sm:py-28"
    >
      <div aria-hidden className="grid-lines-light absolute inset-0 opacity-40 dark:grid-lines dark:opacity-40" />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-48 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(18,201,165,0.12),transparent_68%)] blur-2xl dark:bg-[radial-gradient(circle,rgba(18,201,165,0.18),transparent_68%)]"
      />
      <div className="relative mx-auto grid max-w-[1200px] items-start gap-14 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <Reveal>
          <Eyebrow light>Privacy, plainly stated</Eyebrow>
          <h2 className="mt-5 text-[clamp(2.3rem,5vw,3.75rem)] font-bold text-slate-900 dark:text-white text-balance">
            The server introduces you. It does not take your files.
          </h2>
          <p className="mt-6 max-w-[55ch] text-[15px] leading-[1.8] text-slate-600 dark:text-ink-300">
            Vexuli uses a signaling server to create a room and connect browsers. After you approve the other device,
            files and text flow through an encrypted WebRTC data channel. The signaling server does not receive or
            retain content.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-[11.5px] font-semibold text-slate-700 shadow-sm dark:border-white/12 dark:bg-white/[0.05] dark:text-white">
              <ShieldCheck className="h-3.5 w-3.5 text-signal-600 dark:text-signal-400" /> WebRTC DTLS encryption
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-[11.5px] font-semibold text-slate-700 shadow-sm dark:border-white/12 dark:bg-white/[0.05] dark:text-white">
              <LockKeyhole className="h-3.5 w-3.5 text-signal-600 dark:text-signal-400" /> Sender approval required
            </span>
          </div>
        </Reveal>

        <Reveal delay={130} y={32}>
          <div className="rounded-3xl border border-slate-200/90 bg-white/90 p-6 shadow-sm transition-colors duration-300 dark:border-white/10 dark:bg-ink-900/60 sm:p-7">
            <div className="border-b border-slate-100 pb-4 dark:border-white/8">
              <p className="font-display text-[15px] font-bold text-slate-900 dark:text-white">What goes where</p>
            </div>
            {rows.map(({ icon: Icon, label, description }) => (
              <div key={label} className="flex gap-4 border-b border-slate-100 py-5 last:border-0 dark:border-white/8">
                <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-signal-500/10 text-signal-600 dark:bg-signal-400/10 dark:text-signal-300">
                  <Icon className="h-[19px] w-[19px]" />
                </span>
                <div>
                  <p className="text-[13.5px] font-bold text-slate-900 dark:text-white">{label}</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600 dark:text-ink-300">{description}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11.5px] leading-relaxed text-slate-500 dark:text-ink-400">
            Important: The other peer and network providers may still see your IP address and connection metadata.
            Vexuli is not an anonymity service.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="questions" className="relative scroll-mt-24 py-22 transition-colors duration-300 sm:py-28">
      <div className="mx-auto grid max-w-[1200px] items-start gap-11 px-5 sm:px-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
        <Reveal>
          <Eyebrow>Good to know</Eyebrow>
          <h2 className="mt-5 text-[clamp(2.2rem,4.8vw,3.4rem)] font-bold text-slate-900 dark:text-white text-balance">
            A few things to know before you send.
          </h2>
          <p className="mt-5 max-w-[38ch] text-[14px] leading-relaxed text-slate-600 dark:text-ink-300">
            Straight answers about security, limits and what really happens to your files.
          </p>
          <a
            href="#transfer"
            className="group mt-8 inline-flex items-center gap-2 text-[13px] font-semibold text-signal-600 transition-colors hover:text-signal-700 dark:text-signal-300 dark:hover:text-signal-200"
          >
            Open the transfer space{" "}
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        </Reveal>

        <div className="border-t border-slate-200 dark:border-white/10">
          {questions.map(({ q, a }, index) => (
            <Reveal key={q} delay={Math.min(index * 45, 180)}>
              <details className="group border-b border-slate-200 dark:border-white/10">
                <summary className="flex min-h-[72px] cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-[14px] font-semibold text-slate-900 marker:hidden group-open:text-signal-600 dark:text-white dark:group-open:text-signal-300 [&::-webkit-details-marker]:hidden sm:text-[15px]">
                  <span className="flex items-start gap-4">
                    <span className="mt-0.5 font-mono text-[10px] text-signal-600 dark:text-signal-400/80">0{index + 1}</span>
                    {q}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180 group-open:text-signal-600 dark:text-ink-400 dark:group-open:text-signal-300" />
                </summary>
                <p className="pb-6 pl-8 pr-7 text-[13px] leading-[1.8] text-slate-600 dark:text-ink-300">{a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer({ openTransfer }: { openTransfer: () => void }) {
  return (
    <footer className="relative border-t border-slate-200 bg-white pb-10 pt-16 transition-colors duration-300 dark:border-white/8 dark:bg-ink-950">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        {/* Top Grid */}
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          {/* Brand column */}
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-[34ch] text-[13.5px] leading-relaxed text-slate-600 dark:text-ink-300">
              Direct, private file and text transfer between any two devices. Built with WebRTC data channels,
              end-to-end DTLS encryption, and zero server storage.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-signal-500/25 bg-signal-500/[0.08] px-3.5 py-1.5 font-mono text-[11px] text-signal-700 dark:text-signal-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-signal-500 dark:bg-signal-400" />
              </span>
              All Systems Operational · WebRTC Relays Active
            </div>
          </div>

          {/* Links Col 1: Product */}
          <div>
            <p className="font-mono text-[11px] font-bold tracking-wider text-slate-900 uppercase dark:text-white">
              Product
            </p>
            <ul className="mt-4 space-y-2.5 text-[13px]">
              <li>
                <a href="#transfer" className="text-slate-600 transition-colors hover:text-signal-600 dark:text-ink-300 dark:hover:text-white">
                  Instant Transfer
                </a>
              </li>
              <li>
                <a href="#analytics" className="text-slate-600 transition-colors hover:text-signal-600 dark:text-ink-300 dark:hover:text-white">
                  Real-Time Analytics
                </a>
              </li>
              <li>
                <a href="#how" className="text-slate-600 transition-colors hover:text-signal-600 dark:text-ink-300 dark:hover:text-white">
                  How It Works
                </a>
              </li>
              <li>
                <a href="#privacy" className="text-slate-600 transition-colors hover:text-signal-600 dark:text-ink-300 dark:hover:text-white">
                  Security &amp; Privacy
                </a>
              </li>
              <li>
                <a href="#questions" className="text-slate-600 transition-colors hover:text-signal-600 dark:text-ink-300 dark:hover:text-white">
                  FAQ
                </a>
              </li>
            </ul>
          </div>

          {/* Links Col 2: Security & Protocol */}
          <div>
            <p className="font-mono text-[11px] font-bold tracking-wider text-slate-900 uppercase dark:text-white">
              Protocol
            </p>
            <ul className="mt-4 space-y-2.5 text-[13px]">
              <li>
                <span className="text-slate-600 dark:text-ink-300">WebRTC DataChannel</span>
              </li>
              <li>
                <span className="text-slate-600 dark:text-ink-300">DTLS 1.3 Cryptography</span>
              </li>
              <li>
                <span className="text-slate-600 dark:text-ink-300">4-Digit Ephemeral Rooms</span>
              </li>
              <li>
                <span className="text-slate-600 dark:text-ink-300">Pairing Phrase Verification</span>
              </li>
              <li>
                <span className="text-slate-600 dark:text-ink-300">Zero Server Storage</span>
              </li>
            </ul>
          </div>

          {/* Links Col 3: Resources & Community */}
          <div>
            <p className="font-mono text-[11px] font-bold tracking-wider text-slate-900 uppercase dark:text-white">
              Project
            </p>
            <ul className="mt-4 space-y-2.5 text-[13px]">
              <li>
                <a
                  href="https://github.com/shivaa003/vexuli"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-slate-600 transition-colors hover:text-signal-600 dark:text-ink-300 dark:hover:text-white"
                >
                  GitHub Repository <ArrowUpRight className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://vexuli.vercel.app/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-slate-600 transition-colors hover:text-signal-600 dark:text-ink-300 dark:hover:text-white"
                >
                  Live Web App <ArrowUpRight className="h-3 w-3" />
                </a>
              </li>
              <li>
                <span className="text-slate-500 dark:text-ink-400">Release v0.1.0</span>
              </li>
              <li>
                <span className="text-slate-500 dark:text-ink-400">MIT Open Source</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-slate-100 pt-7 text-[12px] sm:flex-row dark:border-white/8">
          <p className="text-slate-500 dark:text-ink-400">
            © {new Date().getFullYear()} Vexuli. Developed with care by{" "}
            <a
              href="https://github.com/shivaa003"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-slate-700 transition-colors hover:text-signal-600 dark:text-white dark:hover:text-signal-300"
            >
              Shiva
            </a>
            . From your device. To theirs. Directly.
          </p>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={openTransfer}
              className="group inline-flex items-center gap-1.5 font-semibold text-signal-600 transition-colors hover:text-signal-700 dark:text-signal-300 dark:hover:text-signal-200"
            >
              Start a transfer{" "}
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const [engine] = useState(() => new TransferEngine());
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [mode, setMode] = useState<"create" | "join">("create");

  useEffect(() => {
    void engine.checkServer();
    return () => engine.dispose();
  }, [engine]);

  const goToTransfer = (nextMode?: "create" | "join") => {
    if (nextMode) setMode(nextMode);
    document
      .getElementById("transfer")
      ?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
      });
  };

  return (
    <div className="relative min-h-screen overflow-x-clip text-slate-900 transition-colors duration-300 dark:text-ink-100">
      <Backdrop />
      <a
        href="#transfer"
        className="sr-only fixed left-4 top-4 z-[70] rounded-full bg-signal-400 px-5 py-3 text-[13px] font-semibold text-ink-950 focus:not-sr-only"
      >
        Skip to transfer space
      </a>

      <Header
        onJoin={() => goToTransfer("join")}
        online={state.serverOnline}
      />

      <main>
        {/* Hero Section */}
        <section
          id="top"
          className="relative min-h-[790px] overflow-hidden pb-20 pt-33 sm:pt-37 lg:flex lg:items-center lg:pb-25 lg:pt-38"
        >
          <div className="pointer-events-none absolute -top-16 right-[-20%] h-[34rem] w-[44rem] rounded-full bg-[radial-gradient(ellipse,rgba(53,228,193,0.12),transparent_67%)] blur-2xl" />
          <div className="relative mx-auto grid w-full max-w-[1240px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[0.88fr_1.12fr] lg:gap-12 xl:gap-20">
            <div className="max-w-[560px]">
              <Reveal>
                <Eyebrow>Direct file and text transfer</Eyebrow>
              </Reveal>
              <Reveal delay={80}>
                <h1 className="mt-6 font-display text-[clamp(4.6rem,10.2vw,7.9rem)] leading-[0.85] font-extrabold tracking-[-0.085em] text-slate-900 dark:text-white">
                  Vexuli<span className="text-signal-500 dark:text-signal-400">.</span>
                </h1>
              </Reveal>
              <Reveal delay={150}>
                <p className="mt-8 font-display text-[clamp(2.05rem,4vw,3.35rem)] leading-[1.04] font-semibold tracking-[-0.045em] text-slate-900 text-balance dark:text-white">
                  From your device.<br />To theirs.{" "}
                  <span className="text-signal-600 dark:text-signal-300">Directly.</span>
                </p>
              </Reveal>
              <Reveal delay={220}>
                <p className="mt-6 max-w-[47ch] text-[14.5px] leading-[1.8] text-slate-600 sm:text-[15.5px] dark:text-ink-300">
                  Make a four-digit room, connect a second browser and send files or text in real time. You approve who
                  joins. Your content travels over an encrypted WebRTC connection, never through our signaling server.
                </p>
              </Reveal>
              <Reveal delay={280}>
                <div className="mt-8 flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => goToTransfer("create")}
                    className="group inline-flex min-h-[47px] items-center gap-2 rounded-full bg-signal-400 px-5 py-3 text-[13px] font-bold text-ink-950 shadow-[0_20px_45px_-20px_rgba(53,228,193,0.65)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-signal-300"
                  >
                    Start a transfer{" "}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goToTransfer("join")}
                    className="group inline-flex min-h-[47px] items-center gap-2 rounded-full border border-slate-300 bg-white/80 px-5 py-3 text-[13px] font-semibold text-slate-800 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-signal-500 hover:bg-white dark:border-white/15 dark:bg-white/[0.04] dark:text-white dark:hover:border-signal-400/45 dark:hover:bg-white/[0.08]"
                  >
                    I have a code{" "}
                    <ArrowUpRight className="h-4 w-4 text-signal-600 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 dark:text-signal-300" />
                  </button>
                </div>
              </Reveal>
            </div>

            <div className="animate-[pop-in_0.9s_cubic-bezier(0.16,1,0.3,1)_both] [animation-delay:180ms]">
              <TransferWorkspace engine={engine} state={state} mode={mode} onModeChange={setMode} />
            </div>
          </div>
        </section>

        {/* Feature Telemetry Bar */}
        <div className="relative border-y border-slate-200 bg-white/60 py-5 backdrop-blur-sm transition-colors duration-300 dark:border-white/8 dark:bg-ink-900/55">
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5 text-[11px] text-slate-600 sm:justify-between sm:px-8 dark:text-ink-300">
            <span className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-signal-600 dark:text-signal-300" /> One-time 4-digit room
            </span>
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-signal-600 dark:text-signal-300" /> Browser-to-browser encrypted transfer
            </span>
            <span className="flex items-center gap-2">
              <Wifi className="h-3.5 w-3.5 text-signal-600 dark:text-signal-300" /> No accounts on either side
            </span>
          </div>
        </div>

        {/* 📊 REAL-TIME ANALYTICS DASHBOARD SECTION */}
        <AnalyticsDashboard state={state} />

        {/* How It Works Section */}
        <HowItWorks />

        {/* Privacy Section */}
        <Privacy />

        {/* FAQ Section */}
        <Faq />

        {/* Bottom CTA Banner */}
        <section className="relative overflow-hidden border-t border-slate-200/80 py-20 transition-colors duration-300 dark:border-white/8 sm:py-26">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 h-[24rem] w-[45rem] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(53,228,193,0.16),transparent_68%)]"
          />
          <Reveal>
            <div className="relative mx-auto max-w-[1200px] px-5 text-center sm:px-8">
              <Eyebrow>Ready when you are</Eyebrow>
              <h2 className="mx-auto mt-5 max-w-[20ch] text-[clamp(2.2rem,5vw,3.6rem)] font-bold text-slate-900 dark:text-white text-balance">
                The file can be on the other screen in a moment.
              </h2>
              <p className="mx-auto mt-5 max-w-[46ch] text-[14px] leading-relaxed text-slate-600 dark:text-ink-300">
                Both people open this page. One makes a room. The other joins. Nothing to install.
              </p>
              <button
                type="button"
                onClick={() => goToTransfer("create")}
                className="group mt-8 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-signal-400 px-6 py-3 text-[13px] font-bold text-ink-950 transition-all duration-300 hover:-translate-y-0.5 hover:bg-signal-300"
              >
                Open a room{" "}
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>
            </div>
          </Reveal>
        </section>
      </main>

      {/* Professional Footer */}
      <Footer openTransfer={() => goToTransfer("create")} />
    </div>
  );
}
