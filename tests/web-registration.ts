import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";

export async function checkRegistrationHttp(
  origin: string,
  owner: PrismaClient,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const input = {
    requestId: randomUUID(),
    ign: "HTTP web registration ✨",
    tiktokUsername: "PRIVATE_WEB_TIKTOK_CANARY",
    tiktokId: "@private_web_id",
    country: "MY",
  };
  const submit = (body: unknown, requestOrigin = origin) =>
    fetch(`${origin}/api/registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: requestOrigin },
      body: JSON.stringify(body),
    });
  await check(
    "web form exposes all screenshot fields in both locales with exactly four required fields",
    async () => {
      for (const locale of ["en", "ms"]) {
        const html = await (
          await fetch(`${origin}/register`, {
            headers: { Cookie: `pailangz_locale=${locale}` },
          })
        ).text();
        const formTag = html.match(/<form\b[^>]*>/)?.[0] ?? "";
        assert.ok(formTag.includes('method="post"'));
        assert.ok(formTag.includes('action="/api/registration"'));
        for (const field of [
          "ign",
          "whatsapp",
          "tiktokUsername",
          "tiktokId",
          "discordName",
          "discordId",
          "stateProvince",
          "country",
        ]) {
          const control = html.match(
            new RegExp(`<(?:input|select)[^>]*name="${field}"[^>]*>`),
          )?.[0];
          assert.ok(control, field);
          assert.equal(
            /\brequired=""/.test(control),
            ["ign", "tiktokUsername", "tiktokId", "country"].includes(field),
            field,
          );
        }
        assert.ok(html.includes("Nur Athirah"));
        assert.ok(html.includes("atrh0222"));
      }
    },
  );
  await check(
    "public submissions validate on the server and reject cross-origin and oversized requests",
    async () => {
      for (const field of ["ign", "tiktokUsername", "tiktokId", "country"]) {
        const response = await submit({ ...input, [field]: " " });
        assert.equal(response.status, 400, field);
        assert.ok((await response.json()).fields.includes(field));
      }
      assert.equal(
        (await submit(input, "https://untrusted.invalid")).status,
        403,
      );
      assert.equal(
        (await submit({ ...input, unknown: "x".repeat(16_001) })).status,
        413,
      );
      assert.equal(
        await owner.registrationSubmission.count({
          where: { source: "WEB_FORM" },
        }),
        0,
      );
    },
  );
  await check(
    "anonymous form submissions and retries enter private moderator review without exposing answers",
    async () => {
      for (let i = 0; i < 2; i++) {
        const response = await submit({
          ...input,
          role: "ADMIN",
          status: "APPROVED",
        });
        assert.equal(response.status, 202);
        assert.deepEqual(await response.json(), { accepted: true });
        assert.match(
          response.headers.get("cache-control") ?? "",
          /private.*no-store/,
        );
      }
      const rows = await owner.registrationSubmission.findMany({
        where: { source: "WEB_FORM" },
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "PENDING");
      assert.ok(!JSON.stringify(rows).includes(input.tiktokUsername));
      assert.equal(
        await owner.member.count({ where: { displayIgn: input.ign } }),
        0,
      );
      assert.equal(
        await owner.staffUser.count({ where: { name: input.ign } }),
        0,
      );
      const html = await (await fetch(`${origin}/register`)).text();
      assert.ok(!html.includes(input.tiktokUsername));
      assert.ok(
        !JSON.stringify(await owner.auditEvent.findMany()).includes(
          input.tiktokUsername,
        ),
      );
    },
  );
}
