import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Actor } from "../src/lib/db";

export async function checkWebRegistration(
  owner: pg.Client,
  actor: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const { submitRegistration } = await import("../src/lib/registration");
  const { decideRegistration } = await import("../src/lib/imports");
  const { privateDetails, memberUpdate } =
    await import("../src/lib/operations");
  const requestId = randomUUID();
  const input = {
    requestId,
    ign: "Web application ✨",
    tiktokUsername: "PRIVATE_TIKTOK_CANARY",
    tiktokId: "@private_web_canary",
    country: "MY",
  };

  await check(
    "anonymous web intake is encrypted, pending, idempotent and leaves membership/privileges unchanged",
    async () => {
      const counts = async () =>
        (
          await owner.query(
            'SELECT (SELECT count(*) FROM "Member")::int members,(SELECT count(*) FROM "StaffUser")::int staff,(SELECT count(*) FROM "Participant")::int participants',
          )
        ).rows[0];
      const before = await counts();
      await submitRegistration(input);
      await submitRegistration(input);
      assert.deepEqual(await counts(), before);
      const rows = (
        await owner.query(
          'SELECT * FROM "RegistrationSubmission" WHERE source=$1 AND "sourceResponseId"=$2',
          ["WEB_FORM", requestId],
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "PENDING");
      assert.equal(rows[0].phoneIssue, "MISSING");
      assert.ok(!JSON.stringify(rows).includes(input.tiktokUsername));
      assert.ok(!JSON.stringify(rows).includes(input.tiktokId));
      const details = await privateDetails(actor, "submission", requestId);
      assert.equal(details.fields?.["Tiktok username"], input.tiktokUsername);
      assert.equal(details.fields?.["Tiktok ID"], input.tiktokId);
      const audits = (
        await owner.query('SELECT * FROM "AuditEvent" WHERE "entityId"=$1', [
          requestId,
        ])
      ).rows;
      assert.equal(
        audits.filter((row) => row.action === "REGISTRATION_SUBMIT").length,
        1,
      );
      assert.ok(!JSON.stringify(audits).includes(input.tiktokUsername));
      assert.ok(!JSON.stringify(audits).includes(input.tiktokId));
    },
  );
  await check(
    "web intake does not grant anonymous table reads or direct inserts",
    async () => {
      await owner.query("BEGIN");
      try {
        await owner.query("SET LOCAL ROLE pailangz_app");
        assert.equal(
          (
            await owner.query(
              'SELECT * FROM "RegistrationSubmission" WHERE id=$1',
              [requestId],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (await owner.query('SELECT * FROM "MemberPrivate"')).rowCount,
          0,
        );
        await assert.rejects(
          owner.query('INSERT INTO "ImportJob" (id,source) VALUES ($1,$2)', [
            randomUUID(),
            "WEB_FORM",
          ]),
          /row-level security/,
        );
      } finally {
        await owner.query("ROLLBACK");
      }
    },
  );
  await check(
    "web approval preserves social details and historical members can keep blank TikTok fields",
    async () => {
      const approved = await decideRegistration(actor, {
        id: requestId,
        action: "APPROVE",
      });
      assert.ok(approved.memberId);
      const memberId = approved.memberId!;
      const details = await privateDetails(actor, "member", memberId);
      assert.equal(details.fields?.["Tiktok ID"], input.tiktokId);
      await memberUpdate(actor, {
        id: memberId,
        registrationFields: { "Tiktok ID": "", "Tiktok username": "" },
      });
      await memberUpdate(actor, {
        id: memberId,
        ign: "Web existing blank fields",
      });
      const blank = await privateDetails(actor, "member", memberId);
      assert.equal(blank.fields?.["Tiktok ID"], "");
      assert.equal(blank.fields?.["Tiktok username"], "");
      const duplicateId = randomUUID();
      await submitRegistration({
        ...input,
        requestId: duplicateId,
        ign: "Web existing blank fields",
      });
      assert.equal(
        (
          await owner.query(
            'SELECT "existingMemberId" FROM "IgnConflict" WHERE "submissionId"=$1',
            [duplicateId],
          )
        ).rows[0].existingMemberId,
        memberId,
      );
      const untouched = await privateDetails(actor, "member", memberId);
      assert.equal(untouched.fields?.["Tiktok ID"], "");
      assert.equal(untouched.fields?.["Tiktok username"], "");
    },
  );
}
