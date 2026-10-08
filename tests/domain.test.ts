import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import {
  canonicalIgn,
  calculateStandings,
  validateSeries,
  canAccess,
  assertTransition,
  readiness,
  stageRankingRules,
  rankStandings,
  compareStandings,
} from "../src/lib/domain";
import { encrypt, decrypt } from "../src/lib/crypto";
import { validateFixtures } from "../src/lib/fixture-validation";
import { playerIGNs, fixtureTokens } from "../src/lib/seed-data";
import { csvRows, phoneInfo } from "../src/lib/imports";
import { assertEnvironment } from "../src/lib/db";
beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEYS = JSON.stringify({
    test: randomBytes(32).toString("base64"),
  });
  process.env.ACTIVE_ENCRYPTION_KEY = "test";
  process.env.PHONE_DEFAULT_COUNTRY = "MY";
});
describe("Unicode IGN policy", () => {
  it("normalizes canonical equivalence and trims whitespace", () =>
    expect(canonicalIgn("  U\u0300RBAÑ ")).toBe(canonicalIgn("ÙRBAÑ")));
  it("uses full Unicode case folding", () =>
    expect(canonicalIgn("Straße")).toBe(canonicalIgn("STRASSE")));
  it("preserves diacritics, symbols and the intentional IGN 1", () => {
    expect(canonicalIgn("ÙRBAÑ")).not.toBe(canonicalIgn("URBAN"));
    expect(canonicalIgn("• Mash")).toBe("• mash");
    expect(canonicalIgn("1")).toBe("1");
  });
  it("rejects missing / invisible controls", () => {
    expect(() => canonicalIgn(" ")).toThrow();
    expect(() => canonicalIgn("x\u200b")).toThrow();
  });
});
describe("official schedule integrity", () => {
  it("validates all 64 players, six rounds and 192 unique opponents", () =>
    expect(validateFixtures(playerIGNs, fixtureTokens)).toEqual({
      players: 64,
      rounds: 6,
      matches: 192,
    }));
  it("uses the later P64 reconciliation", () =>
    expect(playerIGNs[63]).toBe("Smith69"));
  it("rejects repeated pairs", () => {
    const rounds = structuredClone(fixtureTokens);
    rounds[1] = rounds[0];
    expect(() => validateFixtures(playerIGNs, rounds)).toThrow();
  });
  it("rejects self and unknown players", () => {
    for (const token of ["01-01", "65-23"]) {
      const rounds = structuredClone(fixtureTokens);
      rounds[0][0] = token;
      expect(() => validateFixtures(playerIGNs, rounds)).toThrow();
    }
  });
});
const rules = {
    seriesPoints: true,
    drawPolicy: "no_draws",
    tiebreakers: ["differential"],
  },
  confirmed = ["seriesPoints", "drawPolicy", "tiebreakers"];
const win = { scoreA: 5, scoreB: 1 },
  loss = { scoreA: 1, scoreB: 5 };
describe("series result rules", () => {
  it("requires a confirmed draw / scoring policy", () =>
    expect(() => validateSeries(3, [win, win], "A_WIN", rules, [])).toThrow());
  it("accepts a completed BO3", () =>
    expect(
      validateSeries(3, [win, loss, win], "A_WIN", rules, confirmed),
    ).toEqual({ a: 2, b: 1 }));
  it("accepts a completed BO5", () =>
    expect(
      validateSeries(5, [loss, win, win, win], "A_WIN", rules, confirmed),
    ).toEqual({ a: 3, b: 1 }));
  it("rejects an incomplete BO3 / BO5", () => {
    expect(() => validateSeries(3, [win], "A_WIN", rules, confirmed)).toThrow();
    expect(() =>
      validateSeries(5, [win, win], "A_WIN", rules, confirmed),
    ).toThrow();
  });
  it("rejects games after a deciding win", () =>
    expect(() =>
      validateSeries(3, [win, win, loss], "A_WIN", rules, confirmed),
    ).toThrow());
  it("rejects unconfigured draws and forfeits", () => {
    expect(() =>
      validateSeries(3, [win, loss], "DRAW", rules, confirmed),
    ).toThrow();
    expect(() =>
      validateSeries(3, [], "A_FORFEIT", rules, confirmed),
    ).toThrow();
  });
  it("allows only a confirmed moderated draw", () =>
    expect(
      validateSeries(
        3,
        [win, loss],
        "DRAW",
        { ...rules, drawPolicy: "moderated_draw" },
        confirmed,
      ),
    ).toEqual({ a: 1, b: 1 }));
  it("allows a forfeit only after confirmation", () =>
    expect(
      validateSeries(
        3,
        [],
        "A_FORFEIT",
        { ...rules, specialOutcomes: "forfeit" },
        [...confirmed, "specialOutcomes"],
      ),
    ).toEqual({ a: 0, b: 0 }));
  it("rejects tied or negative individual game scores", () => {
    expect(() =>
      validateSeries(3, [{ scoreA: 1, scoreB: 1 }], "A_WIN", rules, confirmed),
    ).toThrow();
    expect(() =>
      validateSeries(3, [{ scoreA: -1, scoreB: 2 }], "B_WIN", rules, confirmed),
    ).toThrow();
  });
});
const players = [
  { id: "a", code: "P01", ign: "A" },
  { id: "b", code: "P02", ign: "B" },
  { id: "c", code: "P03", ign: "C" },
];
describe("derived standings", () => {
  it("awards points for series, not individual games", () => {
    const rows = calculateStandings(
      players,
      [
        {
          a: "a",
          b: "b",
          status: "FINALIZED",
          outcome: "A_WIN",
          games: [win, win],
        },
      ],
      rules,
      confirmed,
    );
    expect(rows.find((r) => r.id === "a")).toMatchObject({
      points: 3,
      wins: 1,
      played: 1,
      gameWins: 2,
    });
  });
  it("excludes submitted, disputed and voided results", () => {
    for (const status of ["RESULT_SUBMITTED", "DISPUTED", "VOIDED"])
      expect(
        calculateStandings(
          players,
          [{ a: "a", b: "b", status, outcome: "A_WIN", games: [win, win] }],
          rules,
          confirmed,
        ).every((r) => r.played === 0),
      ).toBe(true);
  });
  it("awards one point each for an accepted draw", () => {
    const rows = calculateStandings(
      players,
      [
        {
          a: "a",
          b: "b",
          status: "FINALIZED",
          outcome: "DRAW",
          games: [win, loss],
        },
      ],
      rules,
      confirmed,
    );
    expect(
      rows
        .filter((r) => ["a", "b"].includes(r.id))
        .every((r) => r.points === 1 && r.draws === 1),
    ).toBe(true);
  });
  it("does not silently rank equal scores by ID / insertion order", () =>
    expect(
      calculateStandings(players, [], rules, confirmed).every(
        (r) => r.rank === null && r.tied,
      ),
    ).toBe(true));
  it("recalculates a corrected outcome", () => {
    const a = calculateStandings(
      players,
      [
        {
          a: "a",
          b: "b",
          status: "FINALIZED",
          outcome: "B_WIN",
          games: [loss, loss],
        },
      ],
      rules,
      confirmed,
    );
    expect(a.find((r) => r.id === "a")?.points).toBe(0);
    expect(a.find((r) => r.id === "b")?.points).toBe(3);
  });
});
describe("private data and authorization", () => {
  it.each(["ANONYMOUS", "MEMBER", "admin", "forged"])(
    "denies role %s",
    (role) => expect(canAccess(role, false, true)).toBe(false),
  );
  it("denies suspended, demoted and unauthenticated staff", () => {
    expect(canAccess("ADMIN", true, true)).toBe(false);
    expect(canAccess("MEMBER", false, true)).toBe(false);
    expect(canAccess("MODERATOR", false, false)).toBe(false);
    expect(canAccess("MODERATOR", false, true, "ADMIN")).toBe(false);
  });
  it("allows currently authenticated staff", () => {
    expect(canAccess("ADMIN", false, true, "ADMIN")).toBe(true);
    expect(canAccess("MODERATOR", false, true)).toBe(true);
  });
  it("encrypts and authenticates personal data with record binding", () => {
    const cipher = encrypt("private-canary", "member:one");
    expect(cipher).not.toContain("private-canary");
    expect(decrypt(cipher, "member:one")).toBe("private-canary");
    expect(() => decrypt(cipher, "member:two")).toThrow();
    const tokens = cipher.split(".");
    tokens[2] = Buffer.alloc(16).toString("base64url");
    expect(() => decrypt(tokens.join("."), "member:one")).toThrow();
  });
  it("preserves phone strings and flags absent or invalid values", () => {
    expect(phoneInfo("0123456789", "MY").phone).toBe("0123456789");
    expect(phoneInfo("", "MY").issue).toBe("MISSING");
    expect(phoneInfo("DEMO_PHONE_ONLY", "MY").issue).toBe(
      "INVALID_REQUIRES_REVIEW",
    );
  });
  it("validates national phone numbers using country names as well as codes", () => {
    const raw = "081234567890";
    expect(phoneInfo(raw, "Indonesia")).toEqual(phoneInfo(raw, "ID"));
    expect(phoneInfo(raw, "Indonesia")).toEqual({
      phone: raw,
      issue: null,
      lastFour: "7890",
    });
    expect(phoneInfo(raw, "MY").issue).toBe("INVALID_REQUIRES_REVIEW");
  });
  it("parses the confirmed private headers without interpreting status as a role", () => {
    const row = csvRows(
      "IGN,Whatsapp Number,status\nExample,0123456789,ADMIN",
    )[0];
    expect(row.status).toBe("ADMIN");
    expect(row["Whatsapp Number"]).toBe("0123456789");
  });
  it("blocks invalid tournament transitions and incomplete readiness", () => {
    expect(() => assertTransition("DRAFT", "COMPLETED")).toThrow();
    expect(() => assertTransition("DRAFT", "REGISTRATION_OPEN")).not.toThrow();
    expect(
      readiness(
        {
          startsAt: null,
          registrationDeadline: null,
          gameTitle: null,
          mappingConfirmed: false,
        },
        [],
        0,
        0,
        { soloCapacity: 64, teamCapacity: 16 },
      ).every((c) => !c.done),
    ).toBe(true);
  });
  it("rejects a preview pointing to production", () => {
    const old = { app: process.env.APP_ENV, db: process.env.DATABASE_ENV };
    process.env.APP_ENV = "preview";
    process.env.DATABASE_ENV = "production";
    try {
      expect(() => assertEnvironment()).toThrow();
    } finally {
      process.env.APP_ENV = old.app;
      process.env.DATABASE_ENV = old.db;
    }
  });
});

describe("stage ranking policy", () => {
  const rows = calculateStandings(players, [], rules, confirmed).map(
    (r, i) => ({
      ...r,
      points: 6,
      wins: i === 0 ? 2 : 1,
      gameWins: i === 1 ? 8 : 3,
      gameLosses: 1,
    }),
  );
  it("uses independently confirmed qualification tiebreakers", () => {
    const policy = stageRankingRules(
      "qualification",
      {
        ...rules,
        tiebreakers: ["wins"],
        qualificationTiebreakers: ["gameWins"],
      },
      [...confirmed, "qualificationTiebreakers"],
    );
    expect(rankStandings(rows, policy.rules, policy.confirmed)[0].id).toBe("b");
  });
  it("does not silently reuse league tiebreakers for qualification", () => {
    const policy = stageRankingRules("qualification", rules, confirmed);
    expect(
      rankStandings(rows, policy.rules, policy.confirmed).every(
        (r) => r.rank === null,
      ),
    ).toBe(true);
  });
  it("manual rankings must respect confirmed metrics before resolving ties", () => {
    expect(
      compareStandings(rows[1], rows[0], { tiebreakers: ["wins"] }, [
        "tiebreakers",
      ]),
    ).toBeGreaterThan(0);
  });
});
