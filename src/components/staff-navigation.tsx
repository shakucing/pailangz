"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NavigationLink } from "./navigation-link";
import { Menu, X } from "lucide-react";

export const staffNavigation = [
  ["overview", "Overview"],
  ["registrations", "Registration inbox"],
  ["members", "Members"],
  ["tournaments", "Tournaments & rules"],
  ["teams", "Team rosters"],
  ["matches", "Fixtures & results"],
  ["content", "Announcements"],
  ["imports", "Registration uploads"],
  ["audit", "Activity history"],
  ["settings", "Registration settings"],
  ["staff", "Staff accounts"],
] as const;
export function StaffNavigation({
  base,
  admin,
}: {
  base: string;
  admin: boolean;
}) {
  const pathname = usePathname(),
    [open, setOpen] = useState(false),
    links = useRef<HTMLElement>(null);
  const section = pathname.split("/")[2] ?? "overview";
  useEffect(() => {
    setOpen(false);
    links.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <>
      <button
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
        ref={links}
        id="staff-navigation"
        aria-label="Staff workspace"
        className={open ? "is-open" : ""}
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
