"use client";
// Adapted from React Bits FadeContent by David Haz. See LICENSE.md here.
import { useEffect, useRef, type PropsWithChildren } from "react";
export function FadeContent({
  children,
  className = "",
  delay = 0,
}: PropsWithChildren<{ className?: string; delay?: number }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Skip decorative work on phones and for reduced-motion users. Content is
    // fully visible before hydration; the browser handles this small animation.
    if (
      !window.matchMedia(
        "(min-width: 801px) and (prefers-reduced-motion: no-preference)",
      ).matches
    )
      return;
    let animation: Animation | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        animation = el.animate(
          [
            { opacity: 0.8, transform: "translateY(10px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 350, delay: delay * 1000, easing: "ease-out" },
        );
        observer.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      animation?.cancel();
    };
  }, [delay]);
  // Server-rendered content stays readable before hydration and without JS.
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
