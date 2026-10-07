import { describe, expect, it } from "vitest";
import { upgradePlan } from "../scripts/neon-migrate";

const expected = [
  { name: "001_initial", checksum: "first" },
  { name: "002_update", checksum: "second" },
];
const applied = (name = "001_initial", checksum = "first") => ({
  migration_name: name,
  checksum,
  finished_at: new Date(),
  rolled_back_at: null,
});

describe("existing Neon database upgrade", () => {
  it("applies only pending migrations and is a no-op when current", () => {
    expect(upgradePlan([applied()], expected)).toEqual([expected[1]]);
    expect(
      upgradePlan([applied(), applied("002_update", "second")], expected),
    ).toEqual([]);
  });
  it("refuses a fresh or unfinished database", () => {
    expect(() => upgradePlan([], expected)).toThrow("initial Neon import");
    expect(() =>
      upgradePlan([{ ...applied(), finished_at: null }], expected),
    ).toThrow("unfinished migration");
  });
  it("refuses changed, unknown, duplicate or skipped migration history", () => {
    for (const rows of [
      [applied("001_initial", "changed")],
      [applied("003_unknown")],
      [applied(), applied()],
      [applied("002_update", "second")],
    ])
      expect(() => upgradePlan(rows, expected)).toThrow();
  });
  it("ignores recovered rollback attempts", () => {
    expect(
      upgradePlan(
        [
          applied(),
          {
            ...applied("002_update", "second"),
            finished_at: null,
            rolled_back_at: new Date(),
          },
        ],
        expected,
      ),
    ).toEqual([expected[1]]);
  });
});
