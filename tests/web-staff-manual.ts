import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Only synthetic accounts and the isolated local server; never hosted events.
assert.equal(process.env.PAILANGZ_ISOLATED_WEB_TEST, "true");
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const owner = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    max: 1,
  }),
});
const origin = process.env.NEXTAUTH_URL!;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const anonymous = await browser.newContext();
  await anonymous.addCookies([
    { name: "pailangz_locale", value: "en", url: origin },
  ]);
  const anonymousPage = await anonymous.newPage();
  for (const area of ["admin", "moderator"]) {
    await anonymousPage.goto(`${origin}/${area}/manual`);
    await anonymousPage.waitForURL(`${origin}/staff`);
    await anonymousPage.getByLabel("Staff email").waitFor({ state: "visible" });
  }
  await anonymous.close();
  for (const role of ["ADMIN", "MODERATOR"] as const) {
    const email = `manual-${randomUUID()}@synthetic.invalid`;
    const password = randomBytes(24).toString("base64url");
    await owner.staffUser.create({
      data: {
        name: "Manual verification",
        email,
        role,
        passwordHash: await hash(password, 12),
      },
    });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      await context.addCookies([
        { name: "pailangz_locale", value: "en", url: origin },
      ]);
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(`${origin}/staff`);
      await page.getByLabel("Staff email").fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Enter staff portal" }).click();
      const area = role.toLowerCase();
      await page.waitForURL(new RegExp(`/${area}$`));
      if (width === 390) await page.locator(".staff-menu-toggle").click();
      await page
        .getByRole("navigation", { name: "Staff workspace" })
        .getByRole("link", { name: "Staff manual", exact: true })
        .click();
      await page.waitForURL(new RegExp(`/${area}/manual$`));
      await page
        .getByRole("heading", { name: "Staff manual", exact: true })
        .waitFor();
      assert.equal(
        (await page
          .locator("[lang=en]")
          .filter({
            has: page.getByRole("heading", {
              name: "Staff manual",
              exact: true,
            }),
          })
          .count()) > 0,
        true,
      );
      assert.equal(
        await page.locator('.staff-nav-link[aria-current="page"]').innerText(),
        "Staff manual",
      );
      for (const target of ["matches", "tournaments"]) {
        assert.equal(
          (await page.locator(`a[href="/${area}/${target}"]`).count()) > 0,
          true,
        );
      }
      await page
        .getByText("Step 2. Enter a normal win, in any game order", {
          exact: true,
        })
        .click();
      const practice = page.getByRole("region", {
        name: "Try any scoring combination",
      });
      const pick = (side: string, game: number) =>
        practice
          .getByRole("button", {
            name: `Practice: Player ${side} wins Game ${game}`,
            exact: true,
          })
          .click();
      for (const [i, side] of ["A", "B", "A"].entries())
        await pick(side, i + 1);
      assert.match(
        await practice.getByRole("status").innerText(),
        /Player A 2 - 1 Player B.*Player A wins/,
      );
      await pick("A", 2);
      assert.equal(await practice.locator("fieldset").count(), 2);
      assert.match(
        await practice.getByRole("status").innerText(),
        /Player A 2 - 0 Player B/,
      );
      await practice
        .getByRole("button", {
          name: "Clear Game 1 & later games",
          exact: true,
        })
        .click();
      assert.equal(await practice.locator("fieldset").count(), 1);
      for (const [length, sequence, score] of [
        [5, ["B", "A", "B", "A", "B"], "Player A 2 - 3 Player B"],
        [7, ["A", "B", "A", "B", "A", "B", "B"], "Player A 3 - 4 Player B"],
        [1, ["A"], "Player A 1 - 0 Player B"],
      ] as const) {
        await practice
          .getByLabel("Best of (games)", { exact: true })
          .fill(String(length));
        for (const [i, side] of sequence.entries()) await pick(side, i + 1);
        assert.ok(
          (await practice.getByRole("status").innerText()).includes(score),
        );
      }
      await practice.getByLabel("Best of (games)", { exact: true }).fill("2");
      assert.equal(await practice.getByRole("alert").isVisible(), true);
      assert.equal(
        await practice
          .getByRole("button", { name: /Practice: Player A/ })
          .first()
          .isDisabled(),
        true,
      );
      await practice.getByLabel("Best of (games)", { exact: true }).fill("99");
      assert.match(
        await practice.getByRole("status").innerText(),
        /First to 50 game wins/,
      );
      await practice.getByLabel("Best of (games)", { exact: true }).fill("3");
      await page
        .getByText("Step 2. Enter a normal win, in any game order", {
          exact: true,
        })
        .click();

      const images = await page
        .locator('a[aria-label^="Enlarge screenshot:"]')
        .evaluateAll((links: HTMLAnchorElement[]) =>
          links.map((link) => link.href),
        );
      for (const url of images)
        assert.equal((await context.request.get(url)).ok(), true, url);
      for (const video of await page.locator("video").all()) {
        const metadata = await video.evaluate(
          async (element: HTMLVideoElement) => {
            element.preload = "metadata";
            element.load();
            if (element.readyState < 1)
              await new Promise<void>((resolve, reject) => {
                element.addEventListener("loadedmetadata", () => resolve(), {
                  once: true,
                });
                element.addEventListener(
                  "error",
                  () => reject(new Error("Tutorial video failed to load")),
                  { once: true },
                );
              });
            return {
              duration: element.duration,
              width: element.videoWidth,
              height: element.videoHeight,
              track: element.querySelector("track")?.src,
            };
          },
        );
        assert.ok(metadata.duration > 60);
        assert.equal(metadata.width, 1920);
        assert.equal(metadata.height, 1080);
        const captions = await context.request.get(metadata.track!);
        assert.equal(captions.ok(), true);
        assert.ok((await captions.text()).startsWith("WEBVTT"));
        const played = await video.evaluate(
          async (element: HTMLVideoElement) => {
            element.muted = true;
            const start = element.currentTime;
            await element.play();
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error("Video playback did not advance")),
                5000,
              );
              element.addEventListener(
                "timeupdate",
                () => {
                  clearTimeout(timeout);
                  resolve();
                },
                { once: true },
              );
            });
            const advanced = element.currentTime > start;
            element.pause();
            return advanced;
          },
        );
        assert.equal(played, true, "Tutorial plays after metadata loads");
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      if (process.env.PAILANGZ_QA_SCREENSHOT_DIR) {
        await mkdir(process.env.PAILANGZ_QA_SCREENSHOT_DIR, {
          recursive: true,
        });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `${process.env.PAILANGZ_QA_SCREENSHOT_DIR}/manual-preview-${area}-${width}.png`,
        });
        await page.screenshot({
          path: `${process.env.PAILANGZ_QA_SCREENSHOT_DIR}/manual-${area}-${width}.png`,
          fullPage: true,
        });
        if (role === "ADMIN" && width === 1440) {
          await page
            .locator("video")
            .first()
            .screenshot({
              path: `${process.env.PAILANGZ_QA_SCREENSHOT_DIR}/scoring-video-frame.png`,
            });
        }
      }
      console.log(
        `PASS ${role} ${width}px: manual navigation, scoring practice, screenshots, video playback, English captions and responsive layout`,
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
  await owner.$disconnect();
}
