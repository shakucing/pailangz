import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  applyNeonDataUpgrade,
  resetEnvironment,
} from "../scripts/neon-data-upgrade";

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  readFile: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

const owner =
  "postgresql://owner:synthetic@ep-test.neon.tech/app?sslmode=verify-full";
const production = {
  DATABASE_URL:
    "postgresql://pailangz_app:synthetic@ep-test.neon.tech/app?sslmode=require",
  APP_ENV: "production",
  DATABASE_ENV: "production",
  DATA_ENCRYPTION_KEYS: '{"synthetic":"test-only"}',
  ACTIVE_ENCRYPTION_KEY: "synthetic",
};
afterEach(() => vi.clearAllMocks());

describe("one-time Neon tournament upgrade", () => {
  it("uses the saved production configuration and rejects keys for another database", () => {
    const env = resetEnvironment(production, owner, "/private/backup");
    expect(env.DATA_ENCRYPTION_KEYS).toBe(production.DATA_ENCRYPTION_KEYS);
    expect(env.MIGRATION_DATABASE_URL).toBe(owner);
    expect(env.LOCAL_PGLITE).toBe("false");
    expect(env.VERCEL_ENV).toBe("production");
    for (const DATABASE_URL of [
      "postgresql://pailangz_app@ep-other.neon.tech/app",
      "postgresql://pailangz_app@ep-test.neon.tech/other",
    ])
      expect(() =>
        resetEnvironment({ ...production, DATABASE_URL }, owner, "/backup"),
      ).toThrow(/does not match/);
  });
  it("does not read credentials or launch reset again after completion", async () => {
    await applyNeonDataUpgrade(
      async () => ({ rows: [{ id: "completed" }] }),
      owner,
      "/missing",
    );
    expect(readFile).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });
  it("applies the pending data reset independently of SQL migration status", async () => {
    vi.mocked(readFile).mockResolvedValue(
      Object.entries(production)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<
      typeof spawnSync
    >);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "completed" }] });
    await applyNeonDataUpgrade(query, owner, "/private/synthetic");
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(vi.mocked(spawnSync).mock.calls[1][1]).toEqual(
      expect.arrayContaining(["--apply", "--neon-upgrade"]),
    );
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("fails the command when the reset rolls back", async () => {
    vi.mocked(readFile).mockResolvedValue(
      Object.entries(production)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0 } as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce({ status: 1 } as ReturnType<typeof spawnSync>);
    await expect(
      applyNeonDataUpgrade(
        async () => ({ rows: [] }),
        owner,
        "/private/synthetic",
      ),
    ).rejects.toThrow(/rolled back/);
  });
});
