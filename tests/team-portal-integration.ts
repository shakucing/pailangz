import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { encrypt } from "../src/lib/crypto";
import sharp from "sharp";

export async function checkTeamPortal(
  owner: pg.Client,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const {
    startMemberAccess,
    endMemberAccess,
    mutateTeam,
    teamState,
    publicTeams,
  } = await import("../src/lib/team-portal");
  const tid = randomUUID(),
    cid = randomUUID(),
    slug = `team-flow-${tid}`;
  await owner.query(
    "INSERT INTO \"Tournament\"(id,slug,name,overview,status,published,\"registrationEnabled\") VALUES($1,$2,'Team flow','Test','REGISTRATION_OPEN',false,true)",
    [tid, slug],
  );
  await owner.query(
    'INSERT INTO "Category"(id,"tournamentId",kind,capacity) VALUES($1,$2,\'TEAM\',3)',
    [cid, tid],
  );
  const people: {
    id: string;
    input: { ign: string; tiktokId: string };
    token: string;
  }[] = [];
  for (let i = 0; i < 9; i++) {
    const id = randomUUID();
    const input = {
      ign: `Team player ${i} ${tid}`,
      tiktokId: `private_team_${i}`,
    };
    await owner.query(
      'INSERT INTO "Member"(id,"displayIgn","canonicalIgn",verified) VALUES($1,$2,$3,true)',
      [id, input.ign, input.ign.toLowerCase()],
    );
    await owner.query(
      'INSERT INTO "MemberPrivate"("memberId","originalIgn","registrationEncrypted","phoneEncrypted") VALUES($1,$2,$3,$4)',
      [
        id,
        input.ign,
        encrypt(
          JSON.stringify({ "Tiktok ID": input.tiktokId, Country: "MY" }),
          `member:${id}`,
        ),
        null,
      ],
    );
    await owner.query(
      'INSERT INTO "Participant"(id,"tournamentId","memberId",code,eligible) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), tid, id, `P${i + 1}`, i !== 8],
    );
    people.push({ id, input, token: await startMemberAccess(input) });
  }
  const [
    captain,
    player,
    outsider,
    fourth,
    fifth,
    sixth,
    seventh,
    eighth,
    pending,
  ] = people;
  let teamSlug = "",
    otherSlug = "";
  const create = (token: string, name: string) =>
    mutateTeam(token, slug, { action: "CREATE", name });
  const apply = (token: string, target = teamSlug) =>
    mutateTeam(token, slug, { action: "APPLY", teamSlug: target });
  const review = (
    token: string,
    applicationId: string,
    action: "APPROVE" | "REJECT",
    target = teamSlug,
  ) => mutateTeam(token, slug, { action, applicationId, teamSlug: target });
  await check(
    "team member sessions verify IGN/TikTok without a phone and cannot be forged",
    async () => {
      await assert.rejects(
        startMemberAccess({ ...captain.input, tiktokId: "wrong" }),
        /VERIFICATION_FAILED/,
      );
      await assert.rejects(
        startMemberAccess({ ...captain.input, ign: "unknown" }),
        /VERIFICATION_FAILED/,
      );
      assert.equal(await teamState("fake-token", slug), null);
      await assert.rejects(
        create(undefined as unknown as string, "No session"),
        /SIGN_IN/,
      );
      await assert.rejects(create("fake-token", "Fake session"), /SIGN_IN/);
      await assert.rejects(
        create(pending.token, "Pending player team"),
        /NOT_APPROVED/,
      );
    },
  );
  await check(
    "approved player creates a slugged public team with the owner in its roster",
    async () => {
      const photo = await sharp({
        create: { width: 320, height: 180, channels: 3, background: "#a6dc26" },
      })
        .png()
        .toBuffer();
      const upload = new File([Uint8Array.from(photo)], "team.png", {
        type: "image/png",
      });
      await assert.rejects(
        mutateTeam(
          pending.token,
          slug,
          { action: "CREATE", name: "Pending image" },
          upload,
        ),
        /NOT_APPROVED/,
      );
      await assert.rejects(
        mutateTeam(
          captain.token,
          slug,
          { action: "CREATE", name: "Invalid image" },
          new File(["bad"], "bad.png", { type: "image/png" }),
        ),
        /INVALID_IMAGE/,
      );
      assert.equal((await publicTeams(slug)).length, 0);
      const created = await mutateTeam(
        captain.token,
        slug,
        { action: "CREATE", name: "Night Owls ✨" },
        upload,
      );
      teamSlug = created.slug;
      assert.match(teamSlug, /^night-owls-[a-f0-9]{8}$/);
      const team = (await publicTeams(slug))[0];
      assert.ok(team.avatarImage);
      assert.ok(team.avatarImage.startsWith("data:image/webp;base64,"));
      assert.equal(
        (
          await sharp(
            Buffer.from(team.avatarImage.split(",")[1], "base64"),
          ).metadata()
        ).width,
        64,
      );
      assert.equal(team.playerCount, 1);
      assert.equal(team.ownerIgn, captain.input.ign);
      assert.deepEqual(team.roster, [{ ign: captain.input.ign, owner: true }]);
      assert.ok(!JSON.stringify(team).includes("private_team_"));
      assert.ok(!JSON.stringify(team).includes("60123456789"));
      assert.equal(
        (await teamState(captain.token, slug, teamSlug))?.isOwner,
        true,
      );
      await assert.rejects(
        create(captain.token, "Second team"),
        /ALREADY_IN_TEAM/,
      );
      await assert.rejects(apply(captain.token), /ALREADY_IN_TEAM/);
      otherSlug = (await create(outsider.token, "Night Owls ✨")).slug;
      assert.notEqual(otherSlug, teamSlug);
      assert.equal(
        (await publicTeams(slug)).find((t) => t.slug === otherSlug)
          ?.avatarImage,
        null,
      );
    },
  );
  await check(
    "applications require tournament approval, stay pending and are visible only to the owner",
    async () => {
      await assert.rejects(apply(pending.token), /NOT_APPROVED/);
      await Promise.all([apply(player.token), apply(player.token)]);
      const ownerState = await teamState(captain.token, slug, teamSlug);
      assert.equal(ownerState?.requests.length, 1);
      assert.equal(
        (await teamState(player.token, slug, teamSlug))?.application,
        "PENDING",
      );
      assert.deepEqual(
        (await teamState(player.token, slug, teamSlug))?.requests,
        [],
      );
      assert.deepEqual(
        (await teamState(outsider.token, slug, teamSlug))?.requests,
        [],
      );
      assert.equal(
        (await publicTeams(slug)).find((t) => t.slug === teamSlug)?.playerCount,
        1,
      );
      await assert.rejects(
        review(outsider.token, ownerState!.requests[0].id, "APPROVE"),
        /OWNER_ONLY/,
      );
      await assert.rejects(
        review(outsider.token, ownerState!.requests[0].id, "REJECT", otherSlug),
        /NOT_FOUND/,
      );
    },
  );
  await check(
    "owner approval rechecks eligibility and atomically adds a player once",
    async () => {
      const request = (await teamState(captain.token, slug, teamSlug))!
        .requests[0];
      await owner.query(
        'UPDATE "Participant" SET eligible=false WHERE "tournamentId"=$1 AND "memberId"=$2',
        [tid, player.id],
      );
      await assert.rejects(
        review(captain.token, request.id, "APPROVE"),
        /APPLICANT_NOT_APPROVED/,
      );
      await owner.query(
        'UPDATE "Participant" SET eligible=true WHERE "tournamentId"=$1 AND "memberId"=$2',
        [tid, player.id],
      );
      await review(captain.token, request.id, "APPROVE");
      await assert.rejects(
        review(captain.token, request.id, "APPROVE"),
        /ALREADY_REVIEWED/,
      );
      assert.equal(
        (await teamState(player.token, slug, teamSlug))?.application,
        "APPROVED",
      );
      assert.equal(
        (await teamState(player.token, slug, teamSlug))?.teamSlug,
        teamSlug,
      );
      assert.equal(
        (await publicTeams(slug)).find((t) => t.slug === teamSlug)?.playerCount,
        2,
      );
      await assert.rejects(apply(player.token, otherSlug), /ALREADY_IN_TEAM/);
    },
  );
  await check(
    "owner rejection leaves the player off the roster and preserves the decision",
    async () => {
      await apply(fourth.token);
      const request = (await teamState(captain.token, slug, teamSlug))!
        .requests[0];
      await review(captain.token, request.id, "REJECT");
      assert.equal(
        (await teamState(fourth.token, slug, teamSlug))?.application,
        "REJECTED",
      );
      assert.equal((await apply(fourth.token)).status, "REJECTED");
      assert.equal(
        (await publicTeams(slug)).find((t) => t.slug === teamSlug)?.playerCount,
        2,
      );
    },
  );
  await check(
    "four-player cap and concurrent approvals cannot overfill or duplicate memberships",
    async () => {
      await apply(fifth.token);
      await apply(sixth.token);
      await apply(seventh.token);
      let requests = (await teamState(captain.token, slug, teamSlug))!.requests;
      await review(captain.token, requests[0].id, "APPROVE");
      requests = (await teamState(captain.token, slug, teamSlug))!.requests;
      const results = await Promise.allSettled(
        requests.map((r) => review(captain.token, r.id, "APPROVE")),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(
        String(
          (
            results.find(
              (r) => r.status === "rejected",
            ) as PromiseRejectedResult
          ).reason,
        ),
        /TEAM_FULL/,
      );
      assert.equal(
        (await publicTeams(slug)).find((t) => t.slug === teamSlug)?.playerCount,
        4,
      );
      await assert.rejects(apply(eighth.token), /TEAM_FULL/);
    },
  );
  await check(
    "accepting another team closes competing applications and enforces team capacity",
    async () => {
      const pendingRequest = (await teamState(captain.token, slug, teamSlug))!
        .requests[0];
      const candidate = people.find((p) => p.input.ign === pendingRequest.ign)!;
      await apply(candidate.token, otherSlug);
      const request = (await teamState(outsider.token, slug, otherSlug))!
        .requests[0];
      await review(outsider.token, request.id, "APPROVE", otherSlug);
      assert.equal(
        (await teamState(candidate.token, slug, teamSlug))?.application,
        "REJECTED",
      );
      await create(eighth.token, "Last slot");
      await assert.rejects(
        create(fourth.token, "Overflow team"),
        /TOURNAMENT_FULL/,
      );
    },
  );
  await check(
    "wrong tournament, closed deadlines, revoked members and expired sessions deny changes",
    async () => {
      await assert.rejects(
        mutateTeam(captain.token, "missing-event", {
          action: "CREATE",
          name: "Missing",
        }),
        /NOT_FOUND/,
      );
      await owner.query(
        'UPDATE "Tournament" SET "registrationDeadline"=now()-interval \'1 second\' WHERE id=$1',
        [tid],
      );
      await assert.rejects(apply(fourth.token, otherSlug), /CLOSED/);
      await owner.query(
        'UPDATE "Tournament" SET "registrationDeadline"=NULL,status=\'REGISTRATION_CLOSED\' WHERE id=$1',
        [tid],
      );
      await assert.rejects(apply(fourth.token, otherSlug), /CLOSED/);
      await owner.query(
        "UPDATE \"Tournament\" SET status='REGISTRATION_OPEN' WHERE id=$1",
        [tid],
      );
      await owner.query('UPDATE "Member" SET archived=true WHERE id=$1', [
        captain.id,
      ]);
      assert.equal(await teamState(captain.token, slug, teamSlug), null);
      await assert.rejects(apply(captain.token, otherSlug), /SIGN_IN/);
      await owner.query('UPDATE "Member" SET archived=false WHERE id=$1', [
        captain.id,
      ]);
      await owner.query(
        'UPDATE "MemberAccessSession" SET "expiresAt"=now()-interval \'1 second\' WHERE "memberId"=$1',
        [captain.id],
      );
      assert.equal(await teamState(captain.token, slug, teamSlug), null);
      await endMemberAccess(outsider.token);
      assert.equal(await teamState(outsider.token, slug, otherSlug), null);
    },
  );
  await check(
    "RLS hides member sessions, application queues and prevents direct public writes",
    async () => {
      await owner.query("BEGIN");
      try {
        await owner.query("SET LOCAL ROLE pailangz_app");
        assert.equal(
          (await owner.query('SELECT * FROM "TeamApplication"')).rowCount,
          0,
        );
        assert.ok(
          (
            await owner.query(
              'SELECT * FROM "PublicTeamDirectory" WHERE "tournamentSlug"=$1',
              [slug],
            )
          ).rowCount,
        );
        await assert.rejects(
          owner.query('SELECT * FROM "MemberAccessSession"'),
          /permission denied/,
        );
      } finally {
        await owner.query("ROLLBACK");
      }
      await owner.query("BEGIN");
      try {
        await owner.query("SET LOCAL ROLE pailangz_app");
        await assert.rejects(
          owner.query(
            'INSERT INTO "TeamApplication"(id,"teamId","memberId") VALUES($1,$2,$3)',
            [randomUUID(), "fake-team", player.id],
          ),
          /permission denied/,
        );
      } finally {
        await owner.query("ROLLBACK");
      }
    },
  );
}
