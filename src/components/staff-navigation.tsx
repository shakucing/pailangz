"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NavigationLink } from "./navigation-link";
import {
  CalendarDays,
  ClipboardList,
  FileUp,
  History,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Menu,
  Settings2,
  ShieldCheck,
  Trophy,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  staffNavigation,
  staffNavigationGroups,
  type StaffNavigationKey,
} from "@/lib/staff-navigation";

const navigationIcons: Record<StaffNavigationKey, LucideIcon> = {
  overview: LayoutDashboard,
  registrations: Inbox,
  members: Users,
  imports: FileUp,
  tournaments: Trophy,
  participation: ClipboardList,
  teams: UsersRound,
  matches: CalendarDays,
  content: Megaphone,
  audit: History,
  settings: Settings2,
  staff: ShieldCheck,
};

export function StaffNavigation({
  base,
  admin,
  children,
}: {
  base: string;
  admin: boolean;
  children?: ReactNode;
}) {
  const pathname = usePathname(),
    [open, setOpen] = useState(false),
    toggle = useRef<HTMLButtonElement>(null);
  const section = pathname.split("/")[2] ?? "overview";
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function renderLink(key: StaffNavigationKey, label: string) {
    const Icon = navigationIcons[key];
    return (
      <NavigationLink
        href={`${base}${key === "overview" ? "" : `/${key}`}`}
        className={`staff-nav-link${key === section ? " active" : ""}`}
        aria-current={key === section ? "page" : undefined}
        onClick={() => {
          if (open) toggle.current?.focus();
          setOpen(false);
        }}
      >
        <Icon size={18} aria-hidden="true" />
        <span>{label}</span>
      </NavigationLink>
    );
  }

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
        {open ? (
          <X size={18} aria-hidden="true" />
        ) : (
          <Menu size={18} aria-hidden="true" />
        )}
        <span>
          {staffNavigation.find(([key]) => key === section)?.[1] ?? "Workspace"}
        </span>
        <span className="muted">{open ? "Close" : "Menu"}</span>
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
        <div className="staff-navigation-links">
          {renderLink("overview", "Overview")}
          {staffNavigationGroups
            .filter((group) => admin || !group.adminOnly)
            .map((group) => (
              <section
                key={group.id}
                className="staff-nav-group"
                aria-labelledby={`staff-nav-${group.id}`}
              >
                <h2 id={`staff-nav-${group.id}`}>{group.label}</h2>
                <ul>
                  {group.items.map(([key, label]) => (
                    <li key={key}>{renderLink(key, label)}</li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
        {children}
      </nav>
    </>
  );
}
