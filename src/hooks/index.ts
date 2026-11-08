import { useEffect, useRef, useState } from "react";

/** Respect the user's motion preference. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Fires once the element scrolls into view. */
export function useInView<T extends HTMLElement>(options?: { threshold?: number; rootMargin?: string }) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setInView(true);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: options?.threshold ?? 0.18, rootMargin: options?.rootMargin ?? "0px 0px -8% 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [options?.threshold, options?.rootMargin]);

  return { ref, inView };
}
