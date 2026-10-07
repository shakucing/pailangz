"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Wordmark } from "./wordmark";

export function HeaderBrand() {
  const pathname = usePathname();
  const router = useRouter();
  const clicks = useRef({ count: 0, startedAt: 0 });
  useEffect(() => {
    clicks.current = { count: 0, startedAt: 0 };
  }, [pathname]);

  if (pathname !== "/")
    return (
      <Link href="/" className="brand">
        <Wordmark />
      </Link>
    );

  return (
    <button
      type="button"
      className="brand brand-trigger"
      aria-label="PAILANGZ"
      onClick={() => {
        const now = Date.now();
        if (!clicks.current.count || now - clicks.current.startedAt > 5_000)
          clicks.current = { count: 0, startedAt: now };
        clicks.current.count += 1;
        if (clicks.current.count === 5) {
          clicks.current.count = 0;
          router.push("/staff");
        }
      }}
    >
      <Wordmark />
    </button>
  );
}
