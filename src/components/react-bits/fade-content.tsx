"use client";
// Adapted from React Bits FadeContent by David Haz. See LICENSE.md here.
import { useEffect, useRef, type PropsWithChildren } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
export function FadeContent({
  children,
  className = "",
  delay = 0,
}: PropsWithChildren<{ className?: string; delay?: number }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const tween = gsap.fromTo(
        el,
        { opacity: 0.65, y: 18 },
        {
          opacity: 1,
          y: 0,
          duration: 0.65,
          delay,
          ease: "power2.out",
          clearProps: "opacity,transform",
          scrollTrigger: { trigger: el, start: "top 92%", once: true },
        },
      );
      return () => {
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    });
    return () => media.revert();
  }, [delay]);
  // Server-rendered content stays readable before hydration and without JS.
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
