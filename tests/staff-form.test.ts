import { describe, expect, it } from "vitest";
import { staffFormData } from "../src/lib/staff-form";
import {
  activityCsv,
  activityDetails,
  friendlyError,
  malaysiaDateInput,
  malaysiaDateSubmission,
} from "../src/lib/staff-presentation";

function form(values: Record<string, string | string[]>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values))
    for (const v of Array.isArray(value) ? value : [value])
      result.append(key, v);
  return result;
}

describe("guided staff forms", () => {
  it("explains errors without changing ordinary words such as assigned or sign in", () => {
    expect(friendlyError("Please sign in with a staff account.")).toBe(
      "Please sign in with a staff account.",
    );
    expect(friendlyError("Capacity must retain all assigned players.")).toBe(
      "Capacity must retain all assigned players.",
    );
    expect(friendlyError("Resolve the missing IGN first.")).toBe(
      "Resolve the missing player name first.",
    );
  });
  it("sends player selections and unchecked archive choices without asking for technical input", () => {
    expect(
      staffFormData(
        [
          { name: "memberIds", label: "Team players", type: "members", max: 4 },
          { name: "archived", label: "Archive", type: "checkbox" },
        ],
        form({ memberIds: '["alice","bob"]' }),
        { categoryId: "team-category" },
      ),
    ).toEqual({
      categoryId: "team-category",
      memberIds: ["alice", "bob"],
      archived: false,
    });
    expect(() =>
      staffFormData(
        [{ name: "memberIds", label: "Team players", type: "members", max: 4 }],
        form({ memberIds: '["a","b","c","d","e"]' }),
      ),
    ).toThrow("no more than 4");
  });
  it("confirms saved choices, including false, and preserves unrelated rules", () => {
    const result = staffFormData(
      [{ name: "rules", label: "Rules", type: "rules" }],
      form({
        previousRules: '{"teamSeeding":"manual","drawPolicy":"no_draws"}',
        previousConfirmed: '["teamSeeding","drawPolicy"]',
        "rule:drawPolicy": "moderated_draw",
        "rule:qualificationCarry": "false",
        "rule:qualificationBestOf": "5",
        "rule:tiebreakers": '["wins","gameWins"]',
      }),
    );
    expect(result).toEqual({
      rules: {
        teamSeeding: "manual",
        drawPolicy: "moderated_draw",
        qualificationCarry: false,
        qualificationBestOf: 5,
        tiebreakers: ["wins", "gameWins"],
      },
      confirmedRules: [
        "teamSeeding",
        "drawPolicy",
        "tiebreakers",
        "qualificationBestOf",
        "qualificationCarry",
      ],
    });
  });
  it("leaves blank choices undecided and removes confirmation when a rule is cleared", () => {
    expect(
      staffFormData(
        [{ name: "rules", label: "Rules", type: "rules" }],
        form({
          previousRules:
            '{"drawPolicy":"no_draws","tiebreakers":["wins"],"evidenceDeadline":"24 hours"}',
          previousConfirmed: '["drawPolicy","tiebreakers","evidenceDeadline"]',
          "rule:drawPolicy": "",
          "rule:tiebreakers": "[]",
          "rule:evidenceDeadline": "   ",
        }),
      ),
    ).toEqual({ rules: { tiebreakers: [] }, confirmedRules: [] });
  });
  it("keeps confirmation on repeated saves without confirming rules outside the dialog", () => {
    const fields = [{ name: "rules", label: "Rules", type: "rules" }];
    const first = staffFormData(
      fields,
      form({
        previousRules: '{"qualificationCarry":false}',
        "rule:drawPolicy": "no_draws",
      }),
    );
    const second = staffFormData(
      fields,
      form({
        previousRules: JSON.stringify(first.rules),
        previousConfirmed: JSON.stringify(first.confirmedRules),
        "rule:drawPolicy": "no_draws",
      }),
    );
    expect(second).toEqual(first);
    expect(second.confirmedRules).toEqual(["drawPolicy"]);
    expect(second.rules).toEqual({
      qualificationCarry: false,
      drawPolicy: "no_draws",
    });
  });
  it("catches duplicate opponents and unequal playoff match counts", () => {
    const fields = [
      {
        name: "pairs",
        label: "Opponents",
        type: "pairs",
        pairCount: 2,
        matchesPerPlayer: 1,
        options: ["a", "b", "c", "d"].map((value) => ({ value, label: value })),
      },
    ];
    expect(() =>
      staffFormData(fields, form({ pairs: '[["a","b"],["b","a"]]' })),
    ).toThrow("more than once");
    expect(() =>
      staffFormData(fields, form({ pairs: '[["a","b"],["a","c"]]' })),
    ).toThrow("exactly 1");
    expect(
      staffFormData(fields, form({ pairs: '[["a","b"],["c","d"]]' })).pairs,
    ).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("retains ranking order and requires the complete entrant list", () => {
    const fields = [
      {
        name: "rankedIds",
        label: "Final rankings",
        type: "ordered",
        min: 2,
        required: true,
      },
    ];
    expect(
      staffFormData(fields, form({ rankedIds: '["bob","alice"]' })).rankedIds,
    ).toEqual(["bob", "alice"]);
    expect(() =>
      staffFormData(fields, form({ rankedIds: '["alice"]' })),
    ).toThrow("complete");
  });
  it("round-trips Malaysia time independently of the device timezone", () => {
    expect(malaysiaDateInput("2026-10-07T12:30:00.000Z")).toBe(
      "2026-10-07T20:30",
    );
    expect(malaysiaDateSubmission("2026-10-07T20:30")).toBe(
      "2026-10-07T12:30:00.000Z",
    );
    expect(
      staffFormData(
        [{ name: "startsAt", label: "Starts", type: "datetime-local" }],
        form({ startsAt: "2026-10-07T20:30" }),
      ).startsAt,
    ).toBe("2026-10-07T12:30:00.000Z");
  });
  it("turns column headings into settings without changing their spelling", () => {
    expect(
      staffFormData(
        [{ name: "value", label: "Columns", type: "mapping" }],
        form({
          "mapping:ign": "Player Name",
          "mapping:phone": "WhatsApp",
          "mapping:country": "Country",
        }),
      ).value,
    ).toEqual({ ign: "Player Name", phone: "WhatsApp", country: "Country" });
  });
  it("creates a readable spreadsheet and protects against spreadsheet formulas", () => {
    const csv = activityCsv([
      {
        createdAt: "2026-10-07T12:00:00Z",
        action: "TEAM_UPDATE",
        actorRole: "ADMIN",
        outcome: "SUCCESS",
        reason: '=SUM(1,2) "example"',
      },
    ]);
    expect(csv).toContain('"Team roster updated"');
    expect(csv).toContain('"\'=SUM(1,2) ""example"""');
    expect(
      activityDetails({
        memberId: "internal-reference",
        correlationId: "tracking",
        eligible: true,
      }),
    ).toEqual([{ label: "Eligible", value: "Yes" }]);
  });
});
