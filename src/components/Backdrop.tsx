/** Ambient, layered page background: light washes, signal grid, drifting packets. */
export default function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      {/* deep washes */}
      <div className="absolute -top-[22rem] left-1/2 h-[52rem] w-[78rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(18,201,165,0.20),transparent_62%)] blur-2xl" />
      <div className="absolute top-[8%] -left-56 h-[38rem] w-[38rem] animate-float-slow rounded-full bg-[radial-gradient(circle_at_center,rgba(100,200,255,0.13),transparent_65%)] blur-2xl" />
      <div className="absolute top-[42%] -right-64 h-[42rem] w-[42rem] animate-float rounded-full bg-[radial-gradient(circle_at_center,rgba(249,144,42,0.10),transparent_66%)] blur-2xl" />
      <div className="absolute bottom-[-14rem] left-[18%] h-[34rem] w-[34rem] animate-float-slow rounded-full bg-[radial-gradient(circle_at_center,rgba(53,228,193,0.12),transparent_66%)] blur-2xl" />

      {/* signal grid */}
      <div className="grid-lines absolute inset-0 [mask-image:radial-gradient(ellipse_at_50%_0%,#000_5%,transparent_72%)] opacity-70" />

      {/* travelling beams */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.5]" preserveAspectRatio="none" viewBox="0 0 1440 1200" fill="none">
        <path d="M-60 260 C 340 130, 780 430, 1500 210" stroke="url(#beam1)" strokeWidth="1.2" strokeDasharray="3 12" className="animate-dash" />
        <path d="M-60 720 C 420 880, 900 540, 1500 760" stroke="url(#beam2)" strokeWidth="1.2" strokeDasharray="2 14" className="animate-dash" style={{ animationDuration: "5.6s" }} />
        <path d="M180 -40 C 380 340, 120 760, 520 1240" stroke="url(#beam2)" strokeWidth="1" strokeDasharray="2 16" className="animate-dash" style={{ animationDuration: "7.2s" }} />
        <defs>
          <linearGradient id="beam1" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#35E4C1" stopOpacity="0" />
            <stop offset="0.5" stopColor="#35E4C1" stopOpacity="0.55" />
            <stop offset="1" stopColor="#64C8FF" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="beam2" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#64C8FF" stopOpacity="0" />
            <stop offset="0.5" stopColor="#FFB454" stopOpacity="0.4" />
            <stop offset="1" stopColor="#64C8FF" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {/* floating packets */}
      {[
        { l: "12%", t: "24%", d: "0s", s: "h-1.5 w-1.5", c: "bg-signal-400/70" },
        { l: "78%", t: "18%", d: "1.4s", s: "h-1 w-1", c: "bg-flare-400/60" },
        { l: "62%", t: "62%", d: "2.6s", s: "h-1.5 w-1.5", c: "bg-sky-beam/60" },
        { l: "26%", t: "74%", d: "3.4s", s: "h-1 w-1", c: "bg-signal-300/70" },
        { l: "88%", t: "48%", d: "0.8s", s: "h-1 w-1", c: "bg-signal-200/50" },
        { l: "44%", t: "8%", d: "2.1s", s: "h-1 w-1", c: "bg-flare-300/50" },
      ].map((p, i) => (
        <span
          key={i}
          className={`absolute ${p.s} ${p.c} animate-float rounded-full blur-[0.4px]`}
          style={{ left: p.l, top: p.t, animationDelay: p.d, animationDuration: `${9 + i * 1.7}s` }}
        />
      ))}

      {/* vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,transparent_40%,rgba(4,7,13,0.72)_100%)]" />
    </div>
  );
}
