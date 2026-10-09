"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RemoveTournamentPlayer } from "./remove-tournament-player";
import { friendlyError } from "@/lib/staff-presentation";

type Entrant = {
  id: string;
  code: string;
  eligible: boolean;
  member: {
    displayIgn: string;
    verified: boolean;
    archived: boolean;
  };
};

export function TournamentPlayerList({
  tournamentId,
  participants,
  capacity,
  mappingConfirmed,
  published,
}: {
  tournamentId: string;
  participants: Entrant[];
  capacity: number;
  mappingConfirmed: boolean;
  published: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const selectAll = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const busy = saving || refreshing;
  const entrants = [...participants].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
  const selectedIds = entrants
    .filter((p) => selected.includes(p.id))
    .map((p) => p.id);
  const allSelected =
    entrants.length > 0 && selectedIds.length === entrants.length;
  const needsReview = entrants.some(
    (p) =>
      selectedIds.includes(p.id) && (!p.member.verified || p.member.archived),
  );
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate = selectedIds.length > 0 && !allSelected;
  }, [selectedIds.length, allSelected]);

  async function updateEligibility(eligible: boolean, participant?: Entrant) {
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "participantsEligibility",
          data: {
            tournamentId,
            ids: participant ? [participant.id] : selectedIds,
            eligible,
            reason: participant ? "" : note,
          },
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Unable to update eligibility.");
      if (!participant) {
        setSelected([]);
        setNote("");
      }
      setFeedback({
        text: participant
          ? `${participant.member.displayIgn} marked ${eligible ? "eligible" : "ineligible"}.`
          : `${body.count} ${body.count === 1 ? "player" : "players"} marked ${eligible ? "eligible" : "ineligible"}.`,
        error: false,
      });
      startTransition(() => router.refresh());
    } catch (error) {
      setFeedback({
        text: friendlyError(
          error instanceof Error
            ? error.message
            : "Unable to update eligibility.",
        ),
        error: true,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel" aria-label="Assigned tournament players">
      <h3>
        Assigned players · {entrants.length} of {capacity}
      </h3>
      <p className="muted text-sm">
        {mappingConfirmed
          ? "Player list confirmed."
          : "Player list awaiting confirmation."}{" "}
        Check the names and participant codes below before confirming the list.
      </p>
      {entrants.length ? (
        <>
          <fieldset
            className="form form-fields mb-4"
            disabled={published || busy}
          >
            <div className="row">
              <p role="status" className="muted text-sm">
                {selectedIds.length} of {entrants.length} players selected
              </p>
              <button
                type="button"
                className="button small"
                disabled={!selectedIds.length || needsReview}
                onClick={() => updateEligibility(true)}
              >
                Mark eligible
              </button>
              <button
                type="button"
                className="button small secondary"
                disabled={!selectedIds.length}
                onClick={() => updateEligibility(false)}
              >
                Mark ineligible
              </button>
            </div>
            {selectedIds.length > 0 && (
              <label htmlFor={`${uid}-bulk-note`}>
                Note (optional)
                <input
                  id={`${uid}-bulk-note`}
                  value={note}
                  maxLength={1000}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Add a note for this eligibility update"
                />
              </label>
            )}
            {needsReview && (
              <p className="muted text-sm">
                Approve and verify the selected members before marking them
                eligible.
              </p>
            )}
          </fieldset>
          {busy && (
            <p role="status" className="muted text-sm">
              Updating eligibility…
            </p>
          )}
          {feedback && (
            <p
              role={feedback.error ? "alert" : "status"}
              className={`feedback ${feedback.error ? "error" : ""}`}
            >
              {feedback.text}
            </p>
          )}
          <div className="table-wrap">
            <table>
              <caption className="sr-only">
                Assigned tournament players and eligibility
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      ref={selectAll}
                      type="checkbox"
                      aria-label="Select all assigned players"
                      checked={allSelected}
                      disabled={published || busy}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked ? entrants.map((p) => p.id) : [],
                        )
                      }
                    />
                  </th>
                  <th scope="col">Code</th>
                  <th scope="col">Player</th>
                  <th scope="col">Eligibility</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entrants.map((p) => {
                  const activeMember = p.member.verified && !p.member.archived;
                  const eligible = p.eligible && activeMember;
                  return (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${p.code} · ${p.member.displayIgn}`}
                          checked={selectedIds.includes(p.id)}
                          disabled={published || busy}
                          onChange={(event) => {
                            setFeedback(null);
                            setSelected((previous) =>
                              event.target.checked
                                ? [...previous, p.id]
                                : previous.filter((id) => id !== p.id),
                            );
                          }}
                        />
                      </td>
                      <td>{p.code}</td>
                      <td>
                        <strong>{p.member.displayIgn}</strong>
                        {!activeMember && (
                          <p className="muted text-sm">Member needs review</p>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`button small${eligible ? "" : " secondary"}`}
                          style={{ whiteSpace: "nowrap" }}
                          aria-pressed={eligible}
                          disabled={published || busy || !activeMember}
                          onClick={() => updateEligibility(!eligible, p)}
                        >
                          {eligible ? "Eligible" : "Ineligible"}
                        </button>
                      </td>
                      <td>
                        <RemoveTournamentPlayer
                          participantId={p.id}
                          playerName={p.member.displayIgn}
                          code={p.code}
                          disabled={published || busy}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted">
          No players have been assigned yet. Choose approved players to add to
          this tournament.
        </p>
      )}
      {published && (
        <p className="muted text-sm">
          Unpublish the tournament before changing eligibility or removing
          players.
        </p>
      )}
    </section>
  );
}
