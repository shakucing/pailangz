import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { encrypt } from "../src/lib/crypto";
import { originalConfiguration } from "../src/lib/tournament-config";
import sharp from "sharp";
import {
  MAX_TEAM_IMAGE_BYTES,
  MAX_TEAM_IMAGE_REQUEST_BYTES,
} from "../src/lib/team-avatar-policy";

export async function checkTeamPortalHttp(
  origin: string,
  owner: PrismaClient,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const slug = `http-teams-${randomUUID()}`;
  const tournament = await owner.tournament.create({
    data: {
      slug,
      name: "Team portal HTTP tournament",
      overview: "Team applications",
      status: "REGISTRATION_OPEN",
      published: false,
      registrationEnabled: true,
      configuration: originalConfiguration,
      categories: {
        create: [
          { kind: "TEAM", capacity: originalConfiguration.teamCapacity },
          { kind: "SOLO", capacity: originalConfiguration.soloCapacity },
        ],
      },
    },
  });
  const players: {
    id: string;
    fields: { ign: string; tiktokId: string };
    cookie: string;
  }[] = [];
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    const fields = {
      ign: `HTTP team player ${i}`,
      tiktokId: `private_http_team_${i}`,
    };
    await owner.member.create({
      data: {
        id,
        displayIgn: fields.ign,
        canonicalIgn: fields.ign.toLowerCase(),
        verified: true,
        privateData: {
          create: {
            originalIgn: fields.ign,
            registrationEncrypted: encrypt(
              JSON.stringify({ "Tiktok ID": fields.tiktokId, Country: "MY" }),
              `member:${id}`,
            ),
          },
        },
        participants: {
          create: {
            tournamentId: tournament.id,
            code: `P${i}`,
            eligible: i !== 3,
          },
        },
      },
    });
    players.push({ id, fields, cookie: "" });
  }
  const request = (
    path: string,
    body?: unknown,
    cookie = "",
    method = "POST",
    requestOrigin = origin,
  ) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: requestOrigin,
        Cookie: cookie,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const endpoint = `/api/teams/${slug}`;
  const uploadTeam = (image: File, cookie: string) => {
    const form = new FormData();
    form.set("action", "CREATE");
    form.set("name", "HTTP Night Owls");
    form.set("image", image);
    return fetch(`${origin}${endpoint}`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
      body: form,
    });
  };
  let teamSlug = "";
  const html = async (path: string, cookie = "") =>
    (
      await fetch(`${origin}${path}`, {
        headers: { Cookie: `${cookie}; pailangz_locale=en` },
      })
    ).text();
  await check(
    "team access recognizes the browser Host when it differs from the configured URL",
    async () => {
      const host = `localhost:${new URL(origin).port}`;
      const response = await fetch(`${origin}/api/member-access`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: host,
          Origin: `http://${host}`,
        },
        body: JSON.stringify({
          ign: "Unknown origin-check player",
          tiktokId: "unknown_origin_check",
        }),
      });
      // It reaches identity verification, rather than failing origin validation.
      assert.equal(response.status, 422);
      assert.equal((await response.json()).error, "VERIFICATION_FAILED");
    },
  );
  await check(
    "team access HTTP rejects cross-origin, malformed, wrong identities and unsigned actions",
    async () => {
      assert.equal(
        (
          await request(
            "/api/member-access",
            players[0].fields,
            "",
            "POST",
            "https://untrusted.invalid",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/member-access", {
            ...players[0].fields,
            tiktokId: "",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/api/member-access", {
            ...players[0].fields,
            tiktokId: "wrong",
          })
        ).status,
        422,
      );
      assert.equal(
        (await request(endpoint, { action: "CREATE", name: "Forged" })).status,
        401,
      );
      for (const player of players) {
        const response = await request("/api/member-access", player.fields);
        assert.equal(response.status, 200, await response.text());
        const session = response.headers
          .getSetCookie()
          .find((v) => v.startsWith("pailangz_member="))!;
        assert.ok(
          session.includes("HttpOnly") && session.includes("SameSite=lax"),
        );
        player.cookie = session.split(";")[0];
        assert.ok(response.headers.get("cache-control")?.includes("no-store"));
      }
    },
  );
  await check(
    "team creation UI and API enforce tournament approval with shareable private-event team pages",
    async () => {
      const anonymous = await html(`/tournaments/${slug}/teams/new`);
      for (const name of ["ign", "tiktokId"])
        assert.ok(anonymous.includes(`name="${name}"`));
      assert.ok(!anonymous.includes('name="whatsapp"'));
      const pending = await html(
        `/tournaments/${slug}/teams/new`,
        players[3].cookie,
      );
      assert.ok(pending.includes("Awaiting tournament approval"));
      assert.ok(!pending.includes('name="name"'));
      const denied = await request(
        endpoint,
        { action: "CREATE", name: "No approval" },
        players[3].cookie,
      );
      assert.equal(denied.status, 403);
      const formPage = await html(
        `/tournaments/${slug}/teams/new`,
        players[0].cookie,
      );
      assert.ok(
        formPage.includes('type="file"') && formPage.includes('name="image"'),
      );
      const photo = await sharp({
        create: { width: 640, height: 360, channels: 3, background: "#abcdef" },
      })
        .png()
        .toBuffer();
      const image = new File([Uint8Array.from(photo)], "team.png", {
        type: "image/png",
      });
      assert.equal((await uploadTeam(image, "")).status, 401);
      assert.equal((await uploadTeam(image, players[3].cookie)).status, 403);
      assert.equal(
        (
          await uploadTeam(
            new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" }),
            players[0].cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await uploadTeam(
            new File(["bad image"], "bad.png", { type: "image/png" }),
            players[0].cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await uploadTeam(
            new File([new Uint8Array(MAX_TEAM_IMAGE_BYTES + 1)], "large.png", {
              type: "image/png",
            }),
            players[0].cookie,
          )
        ).status,
        413,
      );
      const oversized = await fetch(`${origin}${endpoint}`, {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: players[0].cookie,
          "Content-Type": "multipart/form-data; boundary=test",
        },
        body: new Uint8Array(MAX_TEAM_IMAGE_REQUEST_BYTES + 1),
      });
      assert.equal(oversized.status, 413);
      assert.equal(
        await owner.team.count({
          where: { category: { tournamentId: tournament.id } },
        }),
        0,
      );
      const response = await uploadTeam(image, players[0].cookie);
      assert.equal(
        response.status,
        200,
        response.status === 200 ? undefined : await response.text(),
      );
      teamSlug = (await response.json()).slug;
      const home = await html("/");
      assert.ok(
        !home.includes(`href="/tournaments/${slug}/teams/${teamSlug}"`),
        "An unpublished event must not become the public homepage feature",
      );
      const saved = await owner.team.findFirstOrThrow({
        where: { slug: teamSlug },
      });
      assert.ok(saved.avatarImage);
      assert.ok(saved.avatarImage.startsWith("data:image/webp;base64,"));
      const dimensions = await sharp(
        Buffer.from(saved.avatarImage.split(",")[1], "base64"),
      ).metadata();
      assert.equal(dimensions.width, 64);
      assert.equal(dimensions.height, 64);
      assert.ok(!home.includes(saved.avatarImage));
      assert.ok(
        (await html(`/tournaments/${slug}/teams`)).includes(saved.avatarImage),
      );
      const detail = await html(`/tournaments/${slug}/teams/${teamSlug}`);
      assert.ok(detail.includes("HTTP Night Owls"));
      assert.ok(detail.includes(saved.avatarImage));
      assert.ok(detail.includes('width="64" height="64"'));
      assert.ok(
        !detail.includes("private_http_team_") &&
          !detail.includes("60123456789"),
      );
      // Next returns 200 after streaming starts, with its not-found UI and noindex.
      const missing = await html(`/tournaments/${slug}/teams/missing-team`);
      assert.ok(missing.includes("This page is not available yet."));
      assert.ok(missing.includes('name="robots" content="noindex"'));
    },
  );
  await check(
    "applications stay pending, owner-only decisions update roster and applicant status",
    async () => {
      const pending = await request(
        endpoint,
        { action: "APPLY", teamSlug },
        players[3].cookie,
      );
      assert.equal(pending.status, 403);
      for (const index of [1, 2]) {
        const response = await request(
          endpoint,
          { action: "APPLY", teamSlug },
          players[index].cookie,
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).status, "PENDING");
      }
      const team = await owner.team.findFirstOrThrow({
        where: { slug: teamSlug },
        include: { applications: true, memberships: true },
      });
      assert.equal(team.memberships.length, 1);
      const page = await html(
        `/tournaments/${slug}/teams/${teamSlug}`,
        players[0].cookie,
      );
      assert.ok(
        page.includes("Pending applications") &&
          page.includes("HTTP team player 1"),
      );
      const application = team.applications.find(
        (a) => a.memberId === players[1].id,
      )!;
      const forged = await request(
        endpoint,
        { action: "APPROVE", teamSlug, applicationId: application.id },
        players[2].cookie,
      );
      assert.equal(forged.status, 403);
      const approved = await request(
        endpoint,
        { action: "APPROVE", teamSlug, applicationId: application.id },
        players[0].cookie,
      );
      assert.equal(approved.status, 200);
      const rejected = await request(
        endpoint,
        {
          action: "REJECT",
          teamSlug,
          applicationId: team.applications.find(
            (a) => a.memberId === players[2].id,
          )!.id,
        },
        players[0].cookie,
      );
      assert.equal(rejected.status, 200);
      assert.equal(
        await owner.teamMembership.count({
          where: { teamId: team.id, active: true },
        }),
        2,
      );
      assert.ok(
        (
          await html(
            `/tournaments/${slug}/teams/${teamSlug}`,
            players[1].cookie,
          )
        ).includes("You are a member of this team"),
      );
      assert.ok(
        (
          await html(
            `/tournaments/${slug}/teams/${teamSlug}`,
            players[2].cookie,
          )
        ).includes("Your application was rejected"),
      );
      const anonymous = await html(`/tournaments/${slug}/teams/${teamSlug}`);
      assert.ok(!anonymous.includes(application.id));
      assert.ok(!anonymous.includes("HTTP team player 2"));
    },
  );
  await check(
    "member logout revokes the server session and forged stale cookies cannot create teams",
    async () => {
      assert.equal(
        (
          await request(
            "/api/member-access",
            undefined,
            players[0].cookie,
            "DELETE",
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            endpoint,
            { action: "CREATE", name: "Stale session" },
            players[0].cookie,
          )
        ).status,
        401,
      );
    },
  );
}
