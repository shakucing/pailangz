import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

export async function checkPublicSoloPlayerNames(
  owner: pg.Client,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  await check(
    "new published SOLO events expose only eligible, approved player names",
    async () => {
      await owner.query("BEGIN");
      try {
        const soloId = randomUUID(),
          teamId = randomUUID();
        for (const [id, format] of [
          [soloId, "SOLO"],
          [teamId, "TEAM"],
        ] as const) {
          await owner.query(
            "INSERT INTO \"Tournament\"(id,slug,name,overview,status,configuration) VALUES($1,$1,$2,'Name visibility check','REGISTRATION_CLOSED',$3)",
            [
              id,
              `${format} names`,
              JSON.stringify({ ...newTournamentConfiguration, format }),
            ],
          );
          await owner.query(
            'INSERT INTO "Category"(id,"tournamentId",kind,capacity) VALUES($1,$2,$3,$4)',
            [randomUUID(), id, format, format === "SOLO" ? 32 : 8],
          );
        }
        for (const [index, state] of [
          "eligible",
          "archived",
          "unverified",
          "ineligible",
          "withdrawn",
        ].entries()) {
          const memberId = randomUUID();
          await owner.query(
            'INSERT INTO "Member"(id,"displayIgn","canonicalIgn",verified,archived) VALUES($1,$2,$1,$3,$4)',
            [
              memberId,
              `Éagle ${state}`,
              state !== "unverified",
              state === "archived",
            ],
          );
          for (const tournamentId of [soloId, teamId])
            await owner.query(
              'INSERT INTO "Participant"(id,"tournamentId","memberId",code,eligible,provisional,withdrawn) VALUES($1,$2,$3,$4,$5,false,$6)',
              [
                randomUUID(),
                tournamentId,
                memberId,
                `P${String(index + 1).padStart(2, "0")}`,
                state !== "ineligible" && state !== "withdrawn",
                state === "withdrawn",
              ],
            );
        }
        const names = async (slug: string) => {
          await owner.query("SET LOCAL ROLE pailangz_app");
          try {
            return (
              await owner.query(
                'SELECT * FROM "PublicEventPlayerName" WHERE slug=$1 ORDER BY code',
                [slug],
              )
            ).rows;
          } finally {
            await owner.query("RESET ROLE");
          }
        };
        // Registration availability and a landing highlight alone do not
        // publish a new event's player names.
        await owner.query(
          'UPDATE "Tournament" SET "registrationEnabled"=true WHERE id=$1',
          [soloId],
        );
        await owner.query(
          'INSERT INTO "LandingHighlight"(format,"tournamentId") VALUES(\'SOLO\',$1) ON CONFLICT(format) DO UPDATE SET "tournamentId"=excluded."tournamentId"',
          [soloId],
        );
        assert.deepEqual(await names(soloId), []);
        for (const status of [
          "REGISTRATION_CLOSED",
          "IN_PROGRESS",
          "COMPLETED",
        ]) {
          await owner.query(
            'UPDATE "Tournament" SET published=true,status=$2 WHERE id=$1',
            [soloId, status],
          );
          assert.deepEqual(await names(soloId), [
            { slug: soloId, code: "P01", ign: "Éagle eligible" },
          ]);
        }
        await owner.query(
          'UPDATE "Tournament" SET published=false WHERE id=$1',
          [soloId],
        );
        assert.deepEqual(await names(soloId), []);
        for (const status of ["DRAFT", "ARCHIVED"]) {
          await owner.query(
            'UPDATE "Tournament" SET published=true,status=$2 WHERE id=$1',
            [soloId, status],
          );
          assert.deepEqual(await names(soloId), []);
        }
        await owner.query(
          'UPDATE "Tournament" SET published=true WHERE id=$1',
          [teamId],
        );
        assert.deepEqual(await names(teamId), []);
      } finally {
        await owner.query("ROLLBACK");
      }
    },
  );
}
