"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NavigationLink } from "./navigation-link";
import { Menu, X } from "lucide-react";

import { staffNavigation } from "@/lib/staff-navigation";
export function StaffNavigation({
  base,
  admin,
}: {
  base: string;
  admin: boolean;
}) {
  const pathname = usePathname(),
    [open, setOpen] = useState(false),
    toggle = useRef<HTMLButtonElement>(null);
  const section = pathname.split("/")[2] ?? "overview";
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  return (
    <>
      <button
        ref={toggle}
        className="staff-menu-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="staff-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={18} /> : <Menu size={18} />}
        <span>
          {staffNavigation.find(([key]) => key === section)?.[1] ?? "Workspace"}
        </span>
        <span className="muted">Menu</span>
      </button>
      <nav
        id="staff-navigation"
        aria-label="Staff workspace"
        className={open ? "is-open" : ""}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            setOpen(false);
            toggle.current?.focus();
          }
        }}
      >
        {staffNavigation
          .filter(([key]) => admin || !["settings", "staff"].includes(key))
          .map(([key, label]) => (
            <NavigationLink
              key={key}
              href={`${base}${key === "overview" ? "" : `/${key}`}`}
              className={key === section ? "active" : ""}
              aria-current={key === section ? "page" : undefined}
            >
              {label}
            </NavigationLink>
          ))}
      </nav>
    </>
  );
}
