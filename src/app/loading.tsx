"use client";
import { useLocale } from "@/components/locale-context";
export default function Loading() {
  const locale = useLocale();
  return (
    <div className="wrap loading" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      {locale === "en" ? "Loading the arena…" : "Memuatkan arena…"}
    </div>
  );
}
