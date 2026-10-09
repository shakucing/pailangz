"use client";

import { useState, type ReactNode } from "react";
import { EventPresentation } from "./event-presentation";
import type { BracketTeam } from "./interactive-bracket";
import type { EventPresentationData } from "@/lib/event-presentation-data";

export function LandingEventCentre({
  events,
}: {
  events: {
    data: EventPresentationData;
    teams: BracketTeam[];
    directory: ReactNode;
  }[];
}) {
  const [selectedSlug, setSelectedSlug] = useState(events[0]?.data.slug);
  const selected =
    events.find(({ data }) => data.slug === selectedSlug) ?? events[0];
  if (!selected) return null;
  return (
    <>
      <EventPresentation
        data={selected.data}
        configuration={selected.data.configuration}
        teams={selected.teams}
        tournamentOptions={
          events.length > 1
            ? events.map(({ data }) => ({
                slug: data.slug,
                format: data.configuration.format ?? "SOLO",
              }))
            : undefined
        }
        onTournamentChange={setSelectedSlug}
      />
      {selected.directory}
    </>
  );
}
