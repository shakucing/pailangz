"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Pause, Play } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import styles from "./solo-experience.module.css";

const chapters = [
  ["format", "Format", "Format"],
  ["kelayakan", "Kelayakan", "Qualifying"],
  ["knockout", "Knockout", "Knockout"],
  ["peraturan", "Fair play", "Fair play"],
  ["komitmen", "Komitmen", "Commitment"],
  ["hadiah", "Hadiah", "Rewards"],
  ["skuad", "Skuad utama", "Main squad"],
] as const;

export function SoloExperience({
  locale,
  fontClassName,
  hero,
  children,
}: {
  locale: Locale;
  fontClassName: string;
  hero: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  const motion = !paused && !reduced;
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const reveals = Array.from(
      host.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    if (!motion) {
      reveals.forEach((element) =>
        element.setAttribute("data-visible", "true"),
      );
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-visible", "true");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -24px 0px" },
    );
    reveals.forEach((element) => observer.observe(element));
    setEnhanced(true);
    return () => observer.disconnect();
  }, [motion]);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const sections = Array.from(
      host.querySelectorAll<HTMLElement>("[data-chapter]"),
    );
    const layers = Array.from(
      host.querySelectorAll<HTMLElement>("[data-parallax]"),
    );
    let frame = 0;
    let current = -1;
    const update = () => {
      frame = 0;
      const viewport = window.innerHeight;
      const bounds = host.getBoundingClientRect();
      const progress = Math.max(
        0,
        Math.min(1, -bounds.top / Math.max(1, bounds.height - viewport)),
      );
      let index = 0;
      sections.forEach((section, position) => {
        if (section.getBoundingClientRect().top <= viewport * 0.4)
          index = position;
      });
      const offsets = layers.map((layer) => {
        const rect = (layer.parentElement ?? layer).getBoundingClientRect();
        const offset =
          (viewport * 0.5 - (rect.top + rect.height * 0.5)) *
          Number(layer.dataset.parallax);
        return Math.max(-110, Math.min(110, offset));
      });
      host.style.setProperty("--reading-progress", String(progress));
      layers.forEach((layer, position) => {
        layer.style.setProperty(
          "--parallax",
          motion ? `${offsets[position]}px` : "0px",
        );
      });
      if (index !== current) {
        current = index;
        setActive(index);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [motion]);

  return (
    <div
      ref={root}
      className={`${styles.page} ${fontClassName}`}
      data-motion={motion ? "on" : "off"}
      data-enhanced={enhanced ? "true" : undefined}
    >
      {hero}
      <div className={styles.chapterBar}>
        <div className={styles.readingProgress} aria-hidden="true" />
        <div className={styles.chapterInner}>
          <a
            href="#solo-top"
            className={styles.chapterBrand}
            aria-label={t("Kembali ke atas", "Back to top")}
          >
            PZ<span>/</span>SOLO
          </a>
          <nav
            className={styles.chapterNav}
            aria-label={t("Bab kejohanan Solo", "Solo tournament chapters")}
          >
            {chapters.map(([id, ms, en], index) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={active === index ? "location" : undefined}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {locale === "en" ? en : ms}
              </a>
            ))}
          </nav>
          <button
            className={styles.motionButton}
            type="button"
            disabled={reduced}
            aria-pressed={paused || reduced}
            aria-label={
              reduced
                ? t(
                    "Gerakan dikurangkan mengikut tetapan peranti",
                    "Motion reduced by your device preference",
                  )
                : paused
                  ? t("Sambung animasi", "Resume animations")
                  : t("Jeda animasi", "Pause animations")
            }
            title={
              reduced
                ? t("Tetapan gerakan peranti", "Device motion preference")
                : paused
                  ? t("Sambung animasi", "Resume animations")
                  : t("Jeda animasi", "Pause animations")
            }
            onClick={() => setPaused((value) => !value)}
          >
            {paused || reduced ? (
              <Play size={14} aria-hidden="true" />
            ) : (
              <Pause size={14} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      {children}
      <div className={styles.endline}>
        <span>PAILANGZ & PAILANGZZ © {new Date().getFullYear()}</span>
        <a href="#solo-top">
          {t("Kembali ke atas", "Back to top")}{" "}
          <ArrowUp size={15} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
