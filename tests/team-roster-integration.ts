import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Actor } from "../src/lib/db";
import { teamUpdate } from "../src/lib/operations";
import { saveTournament } from "../src/lib/competition";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

export async function checkTeamRosterRegistration(
  owner: pg.Client,
  actor: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const events: string[] = [];
  for (let n = 0; n < 2; n++) {
    const event = await saveTournament(actor, {
      slug: `roster-registration-${randomUUID()}`,
      name: "Synthetic roster registration event",
      overview: "Disposable test",
      status: "DRAFT",
      configuration: {
        ...newTournamentConfiguration,
        scheduleSource: "generated",
      },
      reason: "",
    });
    events.push(event.id);
  }
  const categoryId = (
    await owner.query(
      `SELECT id FROM "Category" WHERE "tournamentId"=$1 AND kind='TEAM'`,
      [events[0]],
    )
  ).rows[0].id;
  const members: Record<string, string> = {};
  for (const [index, kind] of [
    "registered",
    "second",
    "unregistered",
    "otherTournament",
    "ineligible",
    "withdrawn",
    "unverified",
    "archived",
  ].entries()) {
    const id = randomUUID();
    members[kind] = id;
    await owner.query(
      'INSERT INTO "Member" (id,"displayIgn","canonicalIgn",verified,archived) VALUES ($1,$1,$1,$2,$3)',
      [id, kind !== "unverified", kind === "archived"],
    );
    if (kind !== "unregistered")
      await owner.query(
        'INSERT INTO "Participant" (id,"tournamentId","memberId",code,eligible,withdrawn) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          randomUUID(),
          events[kind === "otherTournament" ? 1 : 0],
          id,
          `P${index + 1}`,
          !["ineligible", "withdrawn"].includes(kind),
          kind === "withdrawn",
        ],
      );
  }
  const defaults = { categoryId, name: "Registered team", reason: "" };
  const snapshot = async () => ({
    teams: (
      await owner.query(
        'SELECT id,name,archived,"ownerId","avatarImage" FROM "Team" WHERE "categoryId"=$1 ORDER BY id',
        [categoryId],
      )
    ).rows,
    memberships: (
      await owner.query(
        'SELECT id,"teamId","memberId",active FROM "TeamMembership" WHERE "categoryId"=$1 ORDER BY id',
        [categoryId],
      )
    ).rows,
    audits: (
      await owner.query(
        `SELECT a.id FROM "AuditEvent" a JOIN "Team" t ON t.id=a."entityId" WHERE t."categoryId"=$1 ORDER BY a.id`,
        [categoryId],
      )
    ).rows,
  });
  let teamId = "";
  await check(
    "staff-created rosters accept eligible entrants registered in the selected tournament",
    async () => {
      const team = await teamUpdate(actor, {
        ...defaults,
        memberIds: [members.registered, members.second],
      });
      teamId = team.id;
      assert.deepEqual(
        (await snapshot()).memberships.map((m) => m.memberId).sort(),
        [members.registered, members.second].sort(),
      );
    },
  );
  for (const kind of [
    "unregistered",
    "otherTournament",
    "ineligible",
    "withdrawn",
    "unverified",
    "archived",
  ])
    await check(
      `staff roster creation and edits reject ${kind} players without changing saved data`,
      async () => {
        for (const id of [undefined, teamId]) {
          const before = await snapshot();
          await assert.rejects(
            teamUpdate(actor, {
              ...defaults,
              id,
              name: "Rejected roster change",
              memberIds: [members.registered, members[kind]],
            }),
            /registered and eligible|approved active members/,
          );
          assert.deepEqual(await snapshot(), before);
        }
      },
    );
  await check(
    "teams can still be archived after a roster player loses eligibility",
    async () => {
      await owner.query(
        'UPDATE "Participant" SET eligible=false WHERE "tournamentId"=$1 AND "memberId"=$2',
        [events[0], members.registered],
      );
      await teamUpdate(actor, {
        ...defaults,
        id: teamId,
        archived: true,
        memberIds: [members.registered, members.second],
      });
      const state = await snapshot();
      assert.equal(state.teams[0].archived, true);
      assert.ok(state.memberships.every((m) => !m.active));
    },
  );
}
