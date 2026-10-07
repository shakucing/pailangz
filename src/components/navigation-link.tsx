"use client";
import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

function PendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      className={`navigation-hint ${pending ? "is-pending" : ""}`}
      role="status"
    >
      {pending && <span className="sr-only">Opening page…</span>}
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
