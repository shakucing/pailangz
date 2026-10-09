"use client";

import { ActionForm } from "./action-form";
import { TaskDialog } from "./workspace-dialog";
import { Trash2 } from "lucide-react";
import styles from "./remove-tournament-player.module.css";

export function RemoveTournamentPlayer({
  participantId,
  playerName,
  code,
  tournamentName,
  disabled = false,
}: {
  participantId: string;
  playerName: string;
  code: string;
  tournamentName?: string;
  disabled?: boolean;
}) {
  return (
    <TaskDialog
      label={
        <>
          <Trash2 size={18} aria-hidden="true" />
          <span className="sr-only">Remove player</span>
        </>
      }
      triggerClassName={styles.removeButton}
      title={`Remove player · ${code} · ${playerName}`}
      description={tournamentName}
      disabled={disabled}
    >
      <p className="muted">
        Remove {playerName} from this tournament and free their player slot.
        Their community membership and tournament history are retained. Staff
        must restore their place before they can rejoin.
      </p>
      <p className="muted text-sm">
        Review fixtures and confirm the player list again after removal. Team
        captains need a replacement or an archived team first. Started matches
        and saved scores require an admin-controlled restart.
      </p>
      <ActionForm
        action="changeEntrant"
        fixed={{ id: participantId }}
        fields={[
          {
            name: "reason",
            label: "Reason for removal",
            required: true,
            placeholder: "Explain why this player is leaving the tournament",
          },
        ]}
        label="Remove player from tournament"
      />
    </TaskDialog>
  );
}
