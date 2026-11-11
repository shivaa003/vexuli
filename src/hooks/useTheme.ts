import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    const saved = localStorage.getItem("vexuli_theme");
    if (saved === "light" || saved === "dark") return saved;
    return "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
      root.setAttribute("data-theme", "dark");
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", "#04070d");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", "#f8fafc");
    }
    try {
      localStorage.setItem("vexuli_theme", theme);
    } catch {
      // Ignore in restricted iframe / storage disabled
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return { theme, setTheme, toggleTheme, isDark: theme === "dark" };
}
