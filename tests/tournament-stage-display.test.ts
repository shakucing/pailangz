import { describe, expect, it } from "vitest";
import { tournamentStageCards } from "../src/lib/tournament-stage-display";

function stage(key: string, rankingsFinalized = false) {
  return {
    key,
    format: key === "knockout" ? "KNOCKOUT" : "LEAGUE",
    rankingsFinalized,
    rounds: [] as {
      number: number;
      matches: {
        status: string;
        currentResult: { status: string; outcome: string } | null;
        dependencies: { id: string }[];
      }[];
    }[],
  };
}

function knockout(
  status = "FINALIZED",
  resultStatus = "ACCEPTED",
): ReturnType<typeof stage> {
  return {
    ...stage("knockout"),
    rounds: [
      {
        number: 1,
        matches: [
          { status: "BYE", currentResult: null, dependencies: [] },
          {
            status: "FINALIZED",
            currentResult: { status: "ACCEPTED", outcome: "A_WIN" },
            dependencies: [],
          },
        ],
      },
      {
        number: 2,
        matches: [
          {
            status,
            currentResult: { status: resultStatus, outcome: "B_WIN" },
            dependencies: [] as { id: string }[],
          },
        ],
      },
    ],
  };
}

describe("staff tournament stage display", () => {
  it("orders cards by progression regardless of database order, without mutating it", () => {
    const stages = [stage("knockout"), stage("league"), stage("qualification")];
    expect(
      tournamentStageCards(stages).map((s) => [s.key, s.displayStatus]),
    ).toEqual([
      ["league", "Current stage"],
      ["qualification", "Upcoming"],
      ["knockout", "Upcoming"],
    ]);
    expect(stages[0].key).toBe("knockout");
  });

  it("moves the current stage forward only when rankings are saved and valid", () => {
    expect(
      tournamentStageCards([
        stage("league", true),
        stage("qualification"),
        stage("knockout"),
      ]).map((s) => s.displayStatus),
    ).toEqual(["Completed", "Current stage", "Upcoming"]);
    const league = { ...stage("league"), rounds: knockout().rounds };
    expect(tournamentStageCards([league])[0].displayStatus).toBe(
      "Current stage",
    );
  });

  it("supports direct qualification and independent TEAM progression", () => {
    expect(
      tournamentStageCards([stage("knockout"), stage("league", true)]).map(
        (s) => s.displayStatus,
      ),
    ).toEqual(["Completed", "Current stage"]);
    expect(tournamentStageCards([stage("knockout")])[0].displayStatus).toBe(
      "Current stage",
    );
  });

  it("completes a bracket with accepted results and seeded byes", () => {
    expect(tournamentStageCards([knockout()])[0].displayStatus).toBe(
      "Completed",
    );
  });

  it.each([
    ["SCHEDULED", "ACCEPTED"],
    ["DISPUTED", "ACCEPTED"],
    ["VOIDED", "ACCEPTED"],
    ["RESULT_SUBMITTED", "SUBMITTED"],
    ["FINALIZED", "SUBMITTED"],
  ])("keeps a bracket current with a %s / %s final", (status, resultStatus) => {
    expect(
      tournamentStageCards([knockout(status, resultStatus)])[0].displayStatus,
    ).toBe("Current stage");
  });

  it("does not complete a bracket before its final exists or with a drawn final", () => {
    const bracket = knockout();
    bracket.rounds.pop();
    expect(tournamentStageCards([bracket])[0].displayStatus).toBe(
      "Current stage",
    );
    const drawn = knockout();
    drawn.rounds[1].matches[0].currentResult!.outcome = "DRAW";
    expect(tournamentStageCards([drawn])[0].displayStatus).toBe(
      "Current stage",
    );
  });

  it("reopens the current stage when dependencies are stale", () => {
    const bracket = knockout();
    bracket.rounds[1].matches[0].dependencies.push({ id: "stale" });
    expect(tournamentStageCards([bracket])[0].displayStatus).toBe(
      "Current stage",
    );
    const qualification = {
      ...bracket,
      ...stage("qualification", true),
      rounds: bracket.rounds,
    };
    expect(tournamentStageCards([qualification])[0].displayStatus).toBe(
      "Current stage",
    );
  });
});
