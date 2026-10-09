import Link from "next/link";
import type { Tx } from "@/lib/db";
import { operationalTime } from "@/lib/public-data";
import { SectionPages } from "./operations-sections";
import { staffParticipation } from "@/lib/staff-participation";
import { RemoveTournamentPlayer } from "./remove-tournament-player";

export async function renderParticipation(
  tx: Tx,
  q: Record<string, string | undefined>,
  base: string,
) {
  const search = q.q?.slice(0, 100);
  const page = Math.max(1, Math.min(10000, Math.trunc(Number(q.page)) || 1));
  const { rows, total } = await staffParticipation(tx, { search, page });
  return (
    <div className="stack">
      <p className="muted">
        Players added from tournament drafts and signups, using each event’s own
        format and capacity. Matching approved, active members receive a
        tournament slot automatically. Approved TEAM players can register teams
        and apply to join them; owners approve their applications. Staff can
        manage assignments in Team rosters. Use Remove player to withdraw an
        entrant and free their tournament slot while retaining their member
        record. Unpublish the tournament before removing players.
      </p>
      <form className="filter" method="get">
        <label className="sr-only" htmlFor="participation-search">
          Search tournament players
        </label>
        <input
          id="participation-search"
          name="q"
          defaultValue={search}
          placeholder="Search player name"
        />
        <button className="button small secondary">Filter</button>
      </form>
      {!rows.length ? (
        <div className="panel">
          <p className="muted mb-0">No tournament players or signups found.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Tournament</th>
                <th>Format</th>
                <th>Player slot</th>
                <th>TEAM assignment</th>
                <th>Added through</th>
                <th>Received</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const solo = row.member.participants.find(
                  (p) => p.tournamentId === row.tournamentId,
                );
                const team = row.member.memberships.find(
                  (m) => m.category.tournamentId === row.tournamentId,
                );
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.member.displayIgn}</strong>
                      {(!row.member.verified || row.member.archived) && (
                        <p className="muted">Member needs review</p>
                      )}
                    </td>
                    <td>
                      <Link href={`${base}/tournaments?id=${row.tournamentId}`}>
                        {row.tournamentName}
                      </Link>
                    </td>
                    <td>{row.format ?? "SOLO & TEAM"}</td>
                    <td>
                      {solo
                        ? `${solo.code} · ${solo.withdrawn ? "Withdrawn" : solo.eligible ? "Eligible" : "Needs confirmation"}`
                        : "Awaiting slot"}
                    </td>
                    <td>
                      {row.format === "SOLO" ? (
                        "—"
                      ) : (
                        <Link href={`${base}/teams`}>
                          {team?.team.name ?? "Awaiting assignment"}
                        </Link>
                      )}
                    </td>
                    <td>
                      {row.receivedAt ? "Player signup" : "Staff assignment"}
                    </td>
                    <td>
                      {row.receivedAt ? operationalTime(row.receivedAt) : "—"}
                    </td>
                    <td>
                      {solo && !solo.withdrawn ? (
                        <>
                          <RemoveTournamentPlayer
                            participantId={solo.id}
                            playerName={row.member.displayIgn}
                            code={solo.code}
                            tournamentName={row.tournamentName}
                            disabled={row.tournamentPublished}
                          />
                          {row.tournamentPublished && (
                            <p className="muted text-sm">
                              Unpublish before removing players.
                            </p>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <SectionPages q={q} total={total} base={`${base}/participation`} />
    </div>
  );
}
