"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CalendarDays, Users, ListChecks, History } from "lucide-react";
import { TaskDialogNavigation } from "./workspace-dialog";

const sections = [
  {
    key: "overview",
    label: "Overview & schedule",
    hint: "Dates, registration and publication",
    icon: CalendarDays,
  },
  {
    key: "players",
    label: "Players & teams",
    hint: "Entrants, eligibility and player list",
    icon: Users,
  },
  {
    key: "stages",
    label: "Rules & stages",
    hint: "Confirm rules and advance competition",
    icon: ListChecks,
  },
  {
    key: "updates",
    label: "Sizes & updates",
    hint: "Capacity changes and previous updates",
    icon: History,
  },
] as const;
type Section = (typeof sections)[number]["key"];

function targetSection(id: string): Section | undefined {
  if (id === "tournament-rules" || id.startsWith("tournament-rules-"))
    return "stages";
  if (
    [
      "player-list-confirmation",
      "tournament-players",
      "tournament-teams",
      "tournament-eligibility",
    ].includes(id)
  )
    return "players";
  if (["tournament-overview", "tournament-registration-links"].includes(id))
    return "overview";
}

export function TournamentWorkspace({
  overview,
  players,
  stages,
  updates,
  readiness,
}: Record<Section | "readiness", ReactNode>) {
  const [active, setActive] = useState<Section>("overview");
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const openTask = useCallback((id: string) => {
    const section = targetSection(id);
    if (section) setActive(section);
  }, []);
  function reveal(id: string) {
    const section = targetSection(id);
    if (section) {
      setActive(section);
      requestAnimationFrame(() =>
        document
          .getElementById(id)
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      );
    }
  }
  useEffect(() => {
    const fromHash = () => reveal(window.location.hash.slice(1));
    const fromLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href^="#"]');
      if (link) reveal(link.getAttribute("href")!.slice(1));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    document.addEventListener("click", fromLink);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      document.removeEventListener("click", fromLink);
    };
  }, []);
  const contents = { overview, players, stages, updates };
  return (
    <TaskDialogNavigation onOpen={openTask}>
      <div className="tournament-workspace" ref={root}>
        <aside className="tournament-readiness">{readiness}</aside>
        <div className="tournament-tasks">
          <div
            className="tournament-tabs"
            role="tablist"
            aria-label="Tournament tasks"
          >
            {sections.map((section, index) => (
              <button
                key={section.key}
                id={`${uid}-${section.key}-tab`}
                type="button"
                role="tab"
                aria-selected={active === section.key}
                aria-controls={`${uid}-${section.key}-panel`}
                tabIndex={active === section.key ? 0 : -1}
                onClick={() => setActive(section.key)}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === "ArrowRight" || event.key === "ArrowDown")
                    next = (index + 1) % sections.length;
                  else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
                    next = (index + sections.length - 1) % sections.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = sections.length - 1;
                  else return;
                  event.preventDefault();
                  setActive(sections[next].key);
                  root.current
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    [next]?.focus();
                }}
              >
                <section.icon size={18} aria-hidden="true" />
                <span>{section.label}</span>
              </button>
            ))}
          </div>
          {sections.map((section) => (
            <div
              key={section.key}
              id={`${uid}-${section.key}-panel`}
              role="tabpanel"
              aria-labelledby={`${uid}-${section.key}-tab`}
              hidden={active !== section.key}
              tabIndex={0}
              className="tournament-tab-panel"
            >
              <p className="muted text-sm tournament-section-hint">
                {section.hint}
              </p>
              <div className="stack">{contents[section.key]}</div>
            </div>
          ))}
        </div>
      </div>
    </TaskDialogNavigation>
  );
}
