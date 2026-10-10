"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PlayerResultsDialog } from "./player-results-dialog";
import type { EventStage } from "@/lib/event-presentation-data";
import styles from "./tournament-player-results.module.css";

type Player = { code: string; ign?: string };
const PlayerResultsContext = createContext<{
  players: Map<string, Player>;
  selectPlayer: (code: string) => void;
} | null>(null);

export function useTournamentPlayerResults() {
  return useContext(PlayerResultsContext);
}

export function TournamentPlayerResults({
  participants,
  stages,
  children,
}: {
  participants: Player[];
  stages: EventStage[];
  children: ReactNode;
}) {
  const [selectedCode, selectPlayer] = useState<string | null>(null);
  const players = useMemo(
    () => new Map(participants.map((player) => [player.code, player])),
    [participants],
  );
  const selected = selectedCode ? players.get(selectedCode) : undefined;
  return (
    <PlayerResultsContext.Provider value={{ players, selectPlayer }}>
      {children}
      {selected && (
        <PlayerResultsDialog
          player={selected}
          stages={stages}
          onClose={() => selectPlayer(null)}
        />
      )}
    </PlayerResultsContext.Provider>
  );
}

export function TournamentPlayerName({ value }: { value: string }) {
  const context = useTournamentPlayerResults();
  const player = context?.players.get(value.split(" · ")[0]);
  if (!player || !context) return value;
  const label = player.ign ? `${player.code} · ${player.ign}` : player.code;
  const suffix = value.startsWith(`${label} · `)
    ? value.slice(label.length)
    : "";
  return (
    <>
      <button
        type="button"
        className={styles.playerLink}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          context.selectPlayer(player.code);
        }}
      >
        {label}
      </button>
      {suffix}
    </>
  );
}
