import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Actor } from "../src/lib/db";

export async function checkRoutineStaffOperations(
  owner: pg.Client,
  actor: Actor,
  mod: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const { memberUpdate, privateDetails } =
    await import("../src/lib/operations");
  const { ingest, approveRegistrations, decideRegistration } =
    await import("../src/lib/imports");
  const { submitResult, reviewResult, saveTournament, advanceWinner } =
    await import("../src/lib/competition");
  const { decrypt, encrypt } = await import("../src/lib/crypto");
  const memberId = randomUUID(),
    otherId = randomUUID();
  await owner.query(
    'INSERT INTO "Member" (id,"displayIgn","canonicalIgn") VALUES ($1,$2,$3),($4,$5,$6)',
    [
      memberId,
      "Ops original",
      "ops original",
      otherId,
      "Ops duplicate",
      "ops duplicate",
    ],
  );
  const phone = "+60123456789";
  await check(
    "moderators edit names and contacts without notes; private values stay encrypted and out of audit",
    async () => {
      await memberUpdate(mod, {
        id: memberId,
        ign: "Ops corrected",
        phone,
        registrationFields: {
          Country: "MY",
          "Discord Name": "synthetic handle",
        },
      });
      const stored = (
        await owner.query('SELECT * FROM "MemberPrivate" WHERE "memberId"=$1', [
          memberId,
        ])
      ).rows[0];
      assert.equal(stored.originalIgn, "Ops original");
      assert.equal(stored.phoneLastFour, "6789");
      assert.ok(!JSON.stringify(stored).includes(phone));
      const details = await privateDetails(mod, "member", memberId);
      assert.equal(details.phone, phone);
      assert.equal(details.fields?.["Whatsapp Number"], phone);
      assert.equal(details.fields?.["Discord Name"], "synthetic handle");
      const audit = (
        await owner.query('SELECT * FROM "AuditEvent" WHERE "entityId"=$1', [
          memberId,
        ])
      ).rows;
      assert.ok(
        audit.some((e) => e.action === "MEMBER_UPDATE" && e.actorId === mod.id),
      );
      assert.ok(!JSON.stringify(audit).includes(phone));
      assert.ok(!JSON.stringify(audit).includes("synthetic handle"));
    },
  );
  await check(
    "member duplicate-name failures roll back contacts and preserve source history",
    async () => {
      await assert.rejects(
        memberUpdate(mod, {
          id: memberId,
          ign: "Ops duplicate",
          phone: "+60129999999",
        }),
      );
      const details = await privateDetails(mod, "member", memberId);
      assert.equal(details.phone, phone);
      assert.equal(
        (
          await owner.query('SELECT "displayIgn" FROM "Member" WHERE id=$1', [
            memberId,
          ])
        ).rows[0].displayIgn,
        "Ops corrected",
      );
      await assert.rejects(
        memberUpdate(mod, {
          id: memberId,
          registrationFields: {
            passwordHash: "forbidden",
            __proto__: "not a field",
          },
          reason: "x".repeat(1001),
        }),
      );
    },
  );
  await check(
    "member dropdown edits normalize countries and statuses without changing membership privileges",
    async () => {
      const before = (
        await owner.query('SELECT * FROM "Member" WHERE id=$1', [otherId])
      ).rows[0];
      await memberUpdate(mod, {
        id: otherId,
        phone: "081234567890",
        registrationFields: { Country: "Malaysia", status: " INACTIVE " },
      });
      assert.equal(
        (await privateDetails(mod, "member", otherId)).fields?.Country,
        "MY",
      );
      // Changing only the country must revalidate the saved national number.
      await memberUpdate(mod, {
        id: otherId,
        registrationFields: { Country: "Indonesia" },
      });
      const details = await privateDetails(mod, "member", otherId);
      assert.equal(details.countryField, "Country");
      assert.equal(details.fields?.Country, "ID");
      assert.equal(details.fields?.status, "inactive");
      assert.equal(details.phone, "081234567890");
      const stored = (
        await owner.query(
          'SELECT "phoneIssue" FROM "MemberPrivate" WHERE "memberId"=$1',
          [otherId],
        )
      ).rows[0];
      assert.equal(stored.phoneIssue, null);
      const after = (
        await owner.query('SELECT * FROM "Member" WHERE id=$1', [otherId])
      ).rows[0];
      assert.equal(after.verified, before.verified);
      assert.equal(after.archived, before.archived);
    },
  );
  await check(
    "invalid dropdown values roll back all member edits, including through configured country columns",
    async () => {
      const before = (
        await owner.query('SELECT * FROM "MemberPrivate" WHERE "memberId"=$1', [
          otherId,
        ])
      ).rows[0];
      const invalidFields: Record<string, string>[] = [
        { Country: "Atlantis" },
        { status: "ADMIN" },
        { Status: "APPROVED" },
      ];
      for (const registrationFields of invalidFields) {
        await assert.rejects(
          memberUpdate(mod, {
            id: otherId,
            ign: "Should roll back",
            phone: "+60129999999",
            registrationFields,
          }),
          /Select/,
        );
      }
      assert.deepEqual(
        (
          await owner.query(
            'SELECT * FROM "MemberPrivate" WHERE "memberId"=$1',
            [otherId],
          )
        ).rows[0],
        before,
      );
      assert.equal(
        (
          await owner.query('SELECT "displayIgn" FROM "Member" WHERE id=$1', [
            otherId,
          ])
        ).rows[0].displayIgn,
        "Ops duplicate",
      );
      const mapping = (
        await owner.query(
          'SELECT value FROM "IntegrationSetting" WHERE key=$1',
          ["formMapping"],
        )
      ).rows[0].value;
      try {
        await owner.query(
          'UPDATE "IntegrationSetting" SET value=$1 WHERE key=$2',
          [{ ...mapping, country: "Residence" }, "formMapping"],
        );
        assert.equal(
          (await privateDetails(mod, "member", otherId)).countryField,
          "Residence",
        );
        await assert.rejects(
          memberUpdate(mod, {
            id: otherId,
            registrationFields: { Residence: "ZZ" },
          }),
          /Select a country/,
        );
        await memberUpdate(mod, {
          id: otherId,
          registrationFields: { Residence: " id " },
        });
        assert.equal(
          (await privateDetails(mod, "member", otherId)).fields?.Residence,
          "ID",
        );
      } finally {
        await owner.query(
          'UPDATE "IntegrationSetting" SET value=$1 WHERE key=$2',
          [mapping, "formMapping"],
        );
      }
    },
  );
  await check(
    "legacy dropdown values survive unrelated edits and can be replaced or cleared",
    async () => {
      await owner.query(
        'UPDATE "MemberPrivate" SET "registrationEncrypted"=$1 WHERE "memberId"=$2',
        [
          encrypt(
            JSON.stringify({ Country: "Unknown location", status: "ADMIN" }),
            `member:${otherId}`,
          ),
          otherId,
        ],
      );
      await memberUpdate(mod, {
        id: otherId,
        registrationFields: {
          Country: "Unknown location",
          status: "ADMIN",
          "Discord Name": "Updated handle",
        },
      });
      const details = await privateDetails(mod, "member", otherId);
      assert.equal(details.fields?.Country, "Unknown location");
      assert.equal(details.fields?.status, "ADMIN");
      assert.equal(details.fields?.["Discord Name"], "Updated handle");
      await memberUpdate(mod, {
        id: otherId,
        registrationFields: { Country: "SG", status: "active" },
      });
      await memberUpdate(mod, {
        id: otherId,
        registrationFields: { Country: "", status: "" },
      });
      const cleared = await privateDetails(mod, "member", otherId);
      assert.equal(cleared.fields?.Country, "");
      assert.equal(cleared.fields?.status, "");
    },
  );
  let ids: string[] = [];
  await check(
    "normal and batch approvals need no notes; bulk conflicts leave every selected row unchanged",
    async () => {
      await ingest(
        actor,
        [
          { response_id: "ops-clean-1", IGN: "Ops review one", Country: "MY" },
          { response_id: "ops-clean-2", IGN: "Ops review two", Country: "MY" },
          {
            response_id: "ops-conflict",
            IGN: "Ops corrected",
            "Whatsapp Number": "+60128888888",
            Country: "MY",
          },
        ],
        "OPS_TEST",
      );
      const records = (
        await owner.query(
          'SELECT id,"displayIgn" FROM "RegistrationSubmission" WHERE source=$1',
          ["OPS_TEST"],
        )
      ).rows;
      ids = ["Ops review one", "Ops review two", "Ops corrected"].map(
        (n) => records.find((r) => r.displayIgn === n).id,
      );
      await assert.rejects(approveRegistrations(mod, [ids[0], ids[2]]));
      assert.equal(
        (
          await owner.query(
            'SELECT status FROM "RegistrationSubmission" WHERE id=$1',
            [ids[0]],
          )
        ).rows[0].status,
        "PENDING",
      );
      assert.deepEqual(await approveRegistrations(mod, ids.slice(0, 2)), {
        approved: 2,
      });
    },
  );
  await check(
    "explicit duplicate linking preserves the member's previously saved contact",
    async () => {
      await decideRegistration(mod, {
        id: ids[2],
        action: "APPROVE",
        memberId,
      });
      const details = await privateDetails(mod, "member", memberId);
      assert.equal(details.phone, phone);
      assert.equal(
        (
          await owner.query(
            'SELECT "linkedMemberId",status FROM "RegistrationSubmission" WHERE id=$1',
            [ids[2]],
          )
        ).rows[0].linkedMemberId,
        memberId,
      );
    },
  );
  const { newTournamentConfiguration } =
    await import("../src/lib/tournament-config");
  const t = await saveTournament(actor, {
    name: "Isolated ops scoring",
    configuration: newTournamentConfiguration,
    overview: "Synthetic operation tests",
    status: "DRAFT",
    reason: "",
  });
  const stage = (
    await owner.query(
      'SELECT s.id FROM "Stage" s JOIN "Category" c ON c.id=s."categoryId" WHERE c."tournamentId"=$1 AND s.key=$2',
      [t.id, "league"],
    )
  ).rows[0];
  const round = randomUUID(),
    match = randomUUID();
  await owner.query(
    'UPDATE "Stage" SET rules=$2,"confirmedRules"=$3 WHERE id=$1',
    [
      stage.id,
      {
        seriesPoints: true,
        drawPolicy: "no_draws",
        specialOutcomes: "forfeit",
      },
      ["seriesPoints", "drawPolicy", "specialOutcomes"],
    ],
  );
  await owner.query(
    'INSERT INTO "Round" (id,"stageId",number,name) VALUES ($1,$2,1,$3)',
    [round, stage.id, "Ops round"],
  );
  const playerA = randomUUID(),
    playerB = randomUUID();
  await owner.query(
    'INSERT INTO "Participant" (id,"tournamentId","memberId",code) VALUES ($1,$2,$3,$4),($5,$2,$6,$7)',
    [playerA, t.id, memberId, "P01", playerB, otherId, "P02"],
  );
  await owner.query(
    'INSERT INTO "Match" (id,"roundId","order","sideAId","sideBId","bestOf") VALUES ($1,$2,1,$3,$4,3)',
    [match, round, playerA, playerB],
  );
  let result = "";
  await check(
    "valid results can be confirmed without a note or screenshot",
    async () => {
      result = (
        await submitResult(mod, {
          matchId: match,
          outcome: "A_WIN",
          games: [
            { scoreA: 3, scoreB: 1 },
            { scoreA: 4, scoreB: 1 },
          ],
          idempotencyKey: randomUUID(),
        })
      ).id;
      await reviewResult(mod, { id: result, action: "ACCEPT", reason: "" });
      await reviewResult(mod, { id: result, action: "ACCEPT", reason: "" });
      assert.equal(
        (await owner.query('SELECT status FROM "Match" WHERE id=$1', [match]))
          .rows[0].status,
        "FINALIZED",
      );
      const accepted = (
        await owner.query(
          'SELECT status,"acceptedBy" FROM "ResultVersion" WHERE id=$1',
          [result],
        )
      ).rows[0];
      assert.equal(accepted.status, "ACCEPTED");
      assert.equal(accepted.acceptedBy, mod.id);
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "Evidence" WHERE "resultId"=$1',
            [result],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "AuditEvent" WHERE "entityId"=$1 AND action=\'RESULT_ACCEPT\'',
            [match],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check(
    "forfeits, corrections and disputes still require a meaningful explanation",
    async () => {
      await assert.rejects(
        submitResult(mod, {
          matchId: match,
          outcome: "B_WIN",
          games: [
            { scoreA: 1, scoreB: 3 },
            { scoreA: 1, scoreB: 4 },
          ],
          idempotencyKey: randomUUID(),
        }),
      );
      await assert.rejects(
        submitResult(mod, {
          matchId: match,
          outcome: "A_FORFEIT",
          games: [],
          idempotencyKey: randomUUID(),
        }),
      );
      await assert.rejects(
        reviewResult(mod, { id: result, action: "DISPUTE", reason: "" }),
      );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "ResultVersion" WHERE "matchId"=$1',
            [match],
          )
        ).rows[0].n,
        1,
      );
      const reason = (
        await owner.query('SELECT reason FROM "ResultVersion" WHERE id=$1', [
          result,
        ])
      ).rows[0].reason;
      assert.equal(decrypt(reason, `match:${match}`), "");
    },
  );
  await check(
    "BO5 final winners save, confirm and complete without a screenshot",
    async () => {
      const knockout = (
        await owner.query(
          'SELECT s.id FROM "Stage" s JOIN "Category" c ON c.id=s."categoryId" WHERE c."tournamentId"=$1 AND c.kind=\'SOLO\' AND s.key=\'knockout\'',
          [t.id],
        )
      ).rows[0];
      await owner.query(
        'UPDATE "Stage" SET rules=$2,"confirmedRules"=$3 WHERE id=$1',
        [
          knockout.id,
          { seriesPoints: true, drawPolicy: "no_draws" },
          ["seriesPoints", "drawPolicy"],
        ],
      );
      const finalRound = randomUUID(),
        finalMatch = randomUUID();
      await owner.query(
        'INSERT INTO "Round" (id,"stageId",number,name) VALUES ($1,$2,3,\'Final\')',
        [finalRound, knockout.id],
      );
      await owner.query(
        'INSERT INTO "Match" (id,"roundId","order","sideAId","sideBId","bestOf") VALUES ($1,$2,1,$3,$4,5)',
        [finalMatch, finalRound, playerA, playerB],
      );
      const input = {
        matchId: finalMatch,
        outcome: "B_WIN",
        games: [
          { scoreA: 0, scoreB: 1 },
          { scoreA: 1, scoreB: 0 },
          { scoreA: 0, scoreB: 1 },
          { scoreA: 0, scoreB: 1 },
        ],
        idempotencyKey: randomUUID(),
      };
      const saved = await submitResult(mod, input);
      assert.deepEqual(await submitResult(mod, input), saved);
      await reviewResult(mod, { id: saved.id, action: "ACCEPT", reason: "" });
      assert.deepEqual(
        await advanceWinner(mod, { matchId: finalMatch, reason: "" }),
        { completed: true },
      );
      assert.deepEqual(
        (
          await owner.query(
            'SELECT status,"currentResultId" FROM "Match" WHERE id=$1',
            [finalMatch],
          )
        ).rows[0],
        { status: "FINALIZED", currentResultId: saved.id },
      );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "Evidence" WHERE "resultId"=$1',
            [saved.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
}
