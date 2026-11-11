import type { CSSProperties, ReactNode } from "react";
import { useInView, usePrefersReducedMotion } from "@/hooks";

export function Reveal({ children, delay = 0, y = 26, className }: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const visible = inView || reduced;
  const style: CSSProperties = {
    opacity: visible ? 1 : 0,
    transform: visible ? "none" : `translateY(${y}px)`,
    transition: reduced
      ? "none"
      : `opacity 0.75s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.75s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
    willChange: visible ? "auto" : "opacity, transform",
  };
  return <div ref={ref} style={style} className={className}>{children}</div>;
}

export function Logo() {
  return (
    <a href="#top" className="group inline-flex items-center gap-2.5" aria-label="Vexuli home">
      <span className="relative grid h-9 w-9 place-items-center rounded-[11px] bg-gradient-to-br from-signal-300 via-signal-400 to-signal-600 shadow-[0_10px_24px_-10px_rgba(53,228,193,0.85)] transition-transform duration-500 group-hover:rotate-[-8deg]">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-ink-950" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 5l5.4 13L12 11l3.6 7L21 5" />
        </svg>
      </span>
      <span className="font-display text-[1.32rem] font-extrabold tracking-[-0.045em] text-slate-900 dark:text-white">Vexuli</span>
    </a>
  );
}