"use client";

import { useEffect, useEffectEvent, useTransition } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 10_000;

/** Merge fresh server results while preserving tabs, dialogs and scroll position. */
export function LiveResultsRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = useEffectEvent(() => {
    if (pending) return false;
    startTransition(() => router.refresh());
    return true;
  });

  useEffect(() => {
    let lastRefresh = Date.now();
    let deferred = false;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;

    function check() {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;

      // A filtered fixture can disappear when its status changes. Keep editors
      // mounted until staff finish, including when focus moves to dialog actions.
      if (
        document.querySelector("dialog[open] form") ||
        document.activeElement?.matches(
          'input, textarea, select, [contenteditable="true"]',
        )
      ) {
        deferred = true;
        return;
      }

      // Focus, visibility and online events can arrive together.
      if (Date.now() - lastRefresh < 1_000) return;
      if (refresh()) {
        lastRefresh = Date.now();
        deferred = false;
      }
    }

    function resume() {
      if (!deferred) return;
      clearTimeout(resumeTimer);
      // Allow a closing dialog to unmount and focus to return to its trigger.
      resumeTimer = setTimeout(check, 0);
    }

    const interval = setInterval(check, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    document.addEventListener("focusout", resume);
    document.addEventListener("close", resume, true);
    return () => {
      clearInterval(interval);
      clearTimeout(resumeTimer);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      document.removeEventListener("focusout", resume);
      document.removeEventListener("close", resume, true);
    };
  }, []);

  return null;
}
