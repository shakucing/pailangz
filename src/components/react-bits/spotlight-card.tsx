"use client";
// Adapted from React Bits SpotlightCard by David Haz. See LICENSE.md here.
import { useRef, type PropsWithChildren, type PointerEvent } from "react";
export function SpotlightCard({
  children,
  className = "",
  spotlightColor = "rgba(195, 244, 71, 0.16)",
}: PropsWithChildren<{ className?: string; spotlightColor?: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  function move(e: PointerEvent<HTMLDivElement>) {
    if (
      !ref.current ||
      e.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const box = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--mouse-x", `${e.clientX - box.left}px`);
    ref.current.style.setProperty("--mouse-y", `${e.clientY - box.top}px`);
    ref.current.style.setProperty("--spotlight-color", spotlightColor);
  }
  return (
    <div
      ref={ref}
      onPointerMove={move}
      className={`card-spotlight ${className}`}
    >
      {children}
    </div>
  );
}
