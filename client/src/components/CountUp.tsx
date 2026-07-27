import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  value: number;
  /** milliseconds for the full animation */
  duration?: number;
  /** number of decimal places to show */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** use thousands separators (default true) */
  separator?: boolean;
  className?: string;
}

/**
 * Lightweight animated number that counts up from 0 to `value` on mount and
 * whenever `value` changes. Uses requestAnimationFrame with an ease-out curve.
 * Respects prefers-reduced-motion (renders the final value immediately).
 */
export default function CountUp({
  value,
  duration = 1100,
  decimals = 0,
  prefix = "",
  suffix = "",
  separator = true,
  className,
}: CountUpProps) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !isFinite(value)) {
      setDisplay(value || 0);
      return;
    }

    const from = fromRef.current;
    const start = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setDisplay(from + (value - from) * easeOut(p));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, duration]);

  const formatted = separator
    ? display.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : display.toFixed(decimals);

  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
