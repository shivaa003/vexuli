import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/utils/cn";

export function ThemeToggle({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { theme, toggleTheme, isDark } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(
        "group relative flex items-center justify-center rounded-xl border transition-all duration-300",
        "border-slate-300/80 bg-white/80 text-slate-700 shadow-sm hover:border-slate-400 hover:bg-white hover:text-slate-900",
        "dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-200 dark:hover:border-signal-400/40 dark:hover:bg-white/[0.08] dark:hover:text-white",
        compact ? "h-9 w-9" : "h-10 w-10 sm:h-10 sm:w-10",
        className,
      )}
    >
      <div className="relative h-4 w-4">
        {/* Sun icon */}
        <Sun
          className={cn(
            "absolute inset-0 h-4 w-4 text-amber-500 transition-all duration-300",
            isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100",
          )}
        />
        {/* Moon icon */}
        <Moon
          className={cn(
            "absolute inset-0 h-4 w-4 text-signal-300 transition-all duration-300",
            isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0",
          )}
        />
      </div>
      <span className="sr-only">Toggle theme (currently {theme})</span>
    </button>
  );
}
