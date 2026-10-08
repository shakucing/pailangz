"use client";
import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { useLocale } from "./locale-context";

function PendingHint() {
  const { pending } = useLinkStatus();
  const locale = useLocale();
  if (!pending) return null;
  return (
    <span className="navigation-hint is-pending" role="status">
      <span className="sr-only">
        {locale === "en" ? "Opening page…" : "Membuka halaman…"}
      </span>
    </span>
  );
}
export function NavigationLink({
  children,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <PendingHint />
    </Link>
  );
}
