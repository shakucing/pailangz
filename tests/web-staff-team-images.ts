import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { PrismaClient } from "../src/generated/prisma/client";
import { MAX_TEAM_IMAGE_BYTES } from "../src/lib/team-avatar-policy";

export async function checkStaffTeamImages(
  origin: string,
  owner: PrismaClient,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
  adminCookie: string,
  moderatorCookie: string,
) {
  const tournament = await owner.tournament.create({
    data: {
      slug: `staff-images-${randomUUID()}`,
      name: "Synthetic staff image checks",
      overview: "Disposable image test fixture",
      categories: { create: { kind: "TEAM", capacity: 8 } },
    },
    include: { categories: true },
  });
  const defaults = {
    categoryId: tournament.categories[0].id,
    name: "Synthetic image team",
    memberIds: [],
    reason: "Team image verification",
  };
  const image = async (color: string) =>
    new File(
      [
        Uint8Array.from(
          await sharp({
            create: { width: 180, height: 120, channels: 3, background: color },
          })
            .png()
            .toBuffer(),
        ),
      ],
      "team.png",
      { type: "image/png" },
    );
  async function post(
    data: Record<string, unknown>,
    file?: File,
    cookie = adminCookie,
    requestOrigin = origin,
  ) {
    const body = new FormData();
    body.set("action", "team");
    body.set("data", JSON.stringify({ ...defaults, ...data }));
    if (file) body.set("image", file);
    return fetch(`${origin}/api/staff`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: requestOrigin },
      body,
    });
  }
  let teamId = "";
  let savedImage = "";
  await check(
    "staff team images require authentication and same-origin requests",
    async () => {
      assert.equal((await post({}, await image("red"), "")).status, 401);
      assert.equal(
        (
          await post(
            {},
            await image("red"),
            adminCookie,
            "https://untrusted.invalid",
          )
        ).status,
        403,
      );
      assert.equal(
        await owner.team.count({ where: { categoryId: defaults.categoryId } }),
        0,
      );
    },
  );
  await check(
    "staff can create a team with a resized image and read it on the roster",
    async () => {
      const response = await post({}, await image("red"));
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json();
      teamId = body.id;
      savedImage = body.avatarImage;
      assert.match(savedImage, /^data:image\/webp;base64,/);
      const metadata = await sharp(
        Buffer.from(savedImage.split(",")[1], "base64"),
      ).metadata();
      assert.equal(metadata.width, 64);
      assert.equal(metadata.height, 64);
      const stored = await owner.team.findUniqueOrThrow({
        where: { id: teamId },
      });
      assert.equal(stored.avatarImage, savedImage);
      const html = await (
        await fetch(`${origin}/admin/teams`, {
          headers: { Cookie: adminCookie },
        })
      ).text();
      assert.ok(html.includes(savedImage));
    },
  );
  await check(
    "ordinary roster saves preserve images and moderators can replace them",
    async () => {
      const response = await fetch(`${origin}/api/staff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
          Origin: origin,
        },
        body: JSON.stringify({
          action: "team",
          data: { ...defaults, id: teamId, name: "Renamed image team" },
        }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).avatarImage, savedImage);
      const replacement = await post(
        { id: teamId },
        await image("blue"),
        moderatorCookie,
      );
      assert.equal(replacement.status, 200, await replacement.clone().text());
      const body = await replacement.json();
      assert.notEqual(body.avatarImage, savedImage);
      savedImage = body.avatarImage;
      assert.equal(
        (await owner.team.findUniqueOrThrow({ where: { id: teamId } }))
          .avatarImage,
        savedImage,
      );
    },
  );
  await check(
    "invalid image or roster changes fail without replacing the saved team image",
    async () => {
      for (const [data, file, status] of [
        [
          { id: teamId },
          new File(["not an image"], "fake.png", { type: "image/png" }),
          400,
        ],
        [
          { id: teamId },
          new File([new Uint8Array(MAX_TEAM_IMAGE_BYTES + 1)], "large.png", {
            type: "image/png",
          }),
          413,
        ],
        [{ id: teamId, removeImage: true }, await image("green"), 400],
        [{ id: teamId, memberIds: [randomUUID()] }, await image("green"), 400],
      ] as const) {
        const response = await post(data, file);
        assert.equal(response.status, status, await response.clone().text());
        assert.equal(
          (await owner.team.findUniqueOrThrow({ where: { id: teamId } }))
            .avatarImage,
          savedImage,
        );
      }
      const malformed = new FormData();
      malformed.set("action", "team");
      malformed.set("data", "not json");
      assert.equal(
        (
          await fetch(`${origin}/api/staff`, {
            method: "POST",
            headers: { Cookie: adminCookie, Origin: origin },
            body: malformed,
          })
        ).status,
        400,
      );
    },
  );
  await check(
    "staff can remove a team image and create a team without one",
    async () => {
      const response = await post(
        { id: teamId, removeImage: true },
        undefined,
        moderatorCookie,
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).avatarImage, null);
      assert.equal(
        (await owner.team.findUniqueOrThrow({ where: { id: teamId } }))
          .avatarImage,
        null,
      );
      const withoutImage = await post({ name: "No image team" });
      assert.equal(withoutImage.status, 200);
      assert.equal((await withoutImage.json()).avatarImage, null);
      const audit = await owner.auditEvent.findMany({
        where: { entityId: teamId, action: "TEAM_ROSTER_UPDATE" },
      });
      assert.deepEqual(
        audit
          .flatMap((event) => {
            const change = (event.changes as { imageChange?: string })
              .imageChange;
            return change ? [change] : [];
          })
          .sort(),
        ["added", "removed", "replaced"],
      );
      assert.ok(!JSON.stringify(audit).includes("data:image"));
    },
  );
}
