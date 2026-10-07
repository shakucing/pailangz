import type { TournamentConfiguration } from "./tournament-config";

export type Choice = { value: string; label: string; disabled?: boolean };

const labels: Record<string, string> = {
  ADMIN: "Admin",
  MODERATOR: "Moderator",
  SYSTEM: "Automatic update",
  DRAFT: "Draft",
  PENDING: "Waiting for review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  NEEDS_CLARIFICATION: "Needs more information",
  REGISTRATION_OPEN: "Registration open",
  REGISTRATION_CLOSED: "Registration closed",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
  APPLIED: "Applied",
  SCHEDULED: "Scheduled",
  FINALIZED: "Result confirmed",
  RESULT_SUBMITTED: "Awaiting result review",
  SUBMITTED: "Awaiting review",
  ACCEPTED: "Accepted",
  DISPUTED: "Under review",
  VOIDED: "Cancelled",
  BYE: "Rest round",
  SUCCESS: "Completed",
  FAILURE: "Unsuccessful",
  ACCEPT: "Accept result",
  REJECT: "Reject result",
  DISPUTE: "Open a dispute",
  APPROVE: "Approve membership",
  CLARIFY: "Request more information",
  CSV: "Spreadsheet upload",
  SEED: "Original player list",
  AUTH: "Sign-in activity",
  slug: "Tournament link",
  startsAt: "Tournament starts",
  registrationDeadline: "Registration closes",
  configuration: "Tournament sizes",
  MISSING: "No phone number provided",
  INVALID_REQUIRES_REVIEW: "Phone number needs checking",
  formMapping: "Registration columns",
  responderUrl: "Registration link",
  registrationFields: "Registration details",
  changedFields: "What changed",
  confirmedRules: "Confirmed rules",
  seriesPoints: "Match points",
  A_WIN: "First opponent won",
  B_WIN: "Second opponent won",
  DRAW: "Draw",
  A_FORFEIT: "First opponent forfeited",
  B_FORFEIT: "Second opponent forfeited",
  no_draws: "No draws",
  moderated_draw: "Draws allowed after review",
  none: "None",
  manual: "Chosen by staff",
  ranked_cross: "Pair by final rankings",
  rotating_no_points: "Everyone takes a rest round; no points awarded",
  seeded_top: "Top-ranked entrants advance without playing",
  forfeit: "Forfeits allowed",
  generated: "Created here",
  supplied: "Existing schedule",
  wins: "Matches won",
  differential: "Games won minus games lost",
  gameWins: "Games won",
};
export function friendlyLabel(value: string) {
  return (
    labels[value] ??
    value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]/g, " ")
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

export const sizeFields = [
  ["soloCapacity", "Number of SOLO players", 2],
  ["teamCapacity", "Number of teams", 2],
  ["leagueRounds", "League rounds", 1],
  ["leagueMatchesPerPlayer", "League matches for each player", 1],
  ["soloBracketSize", "Places in the SOLO knockout", 2],
  ["teamBracketSize", "Places in the TEAM knockout", 2],
  ["directSlots", "Players qualifying directly", 0],
  ["playoffSlots", "Players qualifying through playoffs", 0],
  ["playoffEntrants", "Players entering the playoffs", 0],
  ["qualificationMatchesPerPlayer", "Playoff matches for each player", 1],
] as const;

export const ruleFields: {
  key: string;
  label: string;
  choices?: Choice[];
  order?: boolean;
}[] = [
  {
    key: "seriesPoints",
    label: "Match points",
    choices: [{ value: "true", label: "Win: 3 · Draw: 1 · Loss: 0" }],
  },
  {
    key: "drawPolicy",
    label: "Can a match end in a draw?",
    choices: ["no_draws", "moderated_draw"].map((value) => ({
      value,
      label: friendlyLabel(value),
    })),
  },
  {
    key: "tiebreakers",
    label: "League tiebreakers, in priority order",
    order: true,
  },
  {
    key: "qualificationBestOf",
    label: "Playoff match length",
    choices: [
      { value: "3", label: "Best of 3 games" },
      { value: "5", label: "Best of 5 games" },
    ],
  },
  {
    key: "qualificationCarry",
    label: "Points at the start of playoffs",
    choices: [
      { value: "false", label: "Start again from zero" },
      { value: "true", label: "Keep league points" },
    ],
  },
  {
    key: "qualificationPairing",
    label: "Playoff opponents",
    choices: [{ value: "manual", label: "Staff choose each pairing" }],
  },
  {
    key: "qualificationTiebreakers",
    label: "Playoff tiebreakers, in priority order",
    order: true,
  },
  {
    key: "knockoutPairing",
    label: "SOLO knockout opponents",
    choices: [
      {
        value: "ranked_cross",
        label: "Pair league qualifiers against playoff qualifiers by rank",
      },
      { value: "manual", label: "Staff choose the starting order" },
    ],
  },
  {
    key: "teamSeeding",
    label: "TEAM knockout starting order",
    choices: [{ value: "manual", label: "Staff choose the team order" }],
  },
  {
    key: "byePolicy",
    label: "When an entrant has no opponent",
    choices: ["none", "rotating_no_points", "seeded_top"].map((value) => ({
      value,
      label: friendlyLabel(value),
    })),
  },
  {
    key: "specialOutcomes",
    label: "Forfeits",
    choices: [
      { value: "none", label: "Not allowed" },
      { value: "forfeit", label: "Allowed with a reason" },
    ],
  },
  { key: "evidenceDeadline", label: "Deadline for screenshots" },
  { key: "disputeDeadline", label: "Deadline for disputes" },
];
export const metricChoices = ["wins", "differential", "gameWins"].map(
  (value) => ({ value, label: friendlyLabel(value) }),
);

export function ruleLabel(key: string) {
  return ruleFields.find((f) => f.key === key)?.label ?? friendlyLabel(key);
}
export function displayValue(value: unknown): string {
  if (value == null || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.map(displayValue).join(" → ") || "None";
  if (typeof value === "object") return "Updated";
  return typeof value === "string" ? (labels[value] ?? value) : String(value);
}
export function configurationRows(value: unknown) {
  const c = value as Partial<TournamentConfiguration>;
  return [
    ...sizeFields.map(([key, label]) => ({
      key,
      label,
      value: String(c?.[key] ?? "Not set"),
    })),
    ...(["leagueByePolicy", "bracketByePolicy", "scheduleSource"] as const).map(
      (key, i) => ({
        key,
        label: ["League rest rounds", "Knockout rest rounds", "Schedule"][i],
        value: displayValue(c?.[key]),
      }),
    ),
  ];
}

// These inputs are Malaysia time, regardless of the staff member's device timezone.
export function malaysiaDateInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
export function malaysiaDateSubmission(value: string) {
  return value ? new Date(`${value}:00+08:00`).toISOString() : "";
}

export function friendlyError(message: string) {
  if (
    /JSON|Unexpected token|Failed to fetch|fetch failed|SyntaxError/i.test(
      message,
    )
  )
    return "We couldn’t complete that request. Please try again.";
  if (/canonical IGN/i.test(message))
    return "Choose the active member with the same player name.";
  if (/UUID|idempotency|request origin/i.test(message))
    return "Please refresh the page, check your selection, and try again.";
  return message
    .replace(
      /Cannot transition (\w+) to (\w+)\./,
      (_, from: string, to: string) =>
        `The tournament cannot move from ${friendlyLabel(from).toLowerCase()} to ${friendlyLabel(to).toLowerCase()} yet.`,
    )
    .replace(
      /Set a value before confirming (\w+)\./,
      (_, key: string) =>
        `Choose ${ruleLabel(key).toLowerCase()} before confirming it.`,
    )
    .replace(/CSV headers/gi, "Spreadsheet column headings")
    .replace(/CSV/gi, "Registration spreadsheet")
    .replace(
      /stale (bracket )?dependencies/gi,
      "bracket changes awaiting review",
    )
    .replace(/dependencies/gi, "related bracket changes")
    .replace(/snapshot/gi, "saved ranking")
    .replace(/immutable/gi, "read-only")
    .replace(/power of two/gi, "2, 4, 8, 16, 32, 64, 128, or 256")
    .replace(
      /N rounds, N−1 matches per player/gi,
      "one round for each player, with each player facing every other player",
    )
    .replace(/\bIGN\b/gi, "player name");
}

export function privateFieldLabel(key: string) {
  const names: Record<string, string> = {
    IGN: "Player name",
    Timestamp: "Submitted on",
    "Tiktok ID": "TikTok account number",
    "Discord ID": "Discord account number",
    response_id: "Registration reference",
  };
  return names[key] ?? key;
}

export function privateFieldValue(value: unknown) {
  if (typeof value === "string" && value.includes("audited reveal"))
    return "Hidden · use Show phone number below";
  return displayValue(value);
}

const auditLabels: Record<string, string> = {
  STAFF_VIEW: "Workspace opened",
  RULES_CONFIRM: "Tournament rules updated",
  TEAM_UPDATE: "Team roster updated",
  RESULT_SUBMIT: "Result submitted",
  RESULT_ACCEPT: "Result accepted",
  RESULT_REJECT: "Result rejected",
  RESULT_DISPUTE: "Result disputed",
  MATCH_UPDATE: "Match updated",
  RANKING_FREEZE: "Final rankings saved",
  AUDIT_EXPORT: "Activity history downloaded",
  OPERATION_FAILED: "An action could not be completed",
  PLAYER_MAPPING_CONFIRM: "Player list confirmed",
  PARTICIPANT_ELIGIBILITY: "Player eligibility updated",
  MEMBER_UPDATE: "Member updated",
  INTEGRATION_SETTING: "Registration settings updated",
  QUALIFICATION_CREATE: "Playoff matches created",
  BRACKET_CREATE: "SOLO knockout created",
  TEAM_BRACKET_CREATE: "TEAM knockout created",
  DEPENDENCIES_STALE: "Bracket needs review",
};
export function activityLabel(action: string) {
  return auditLabels[action] ?? friendlyLabel(action);
}
export function activityDetails(changes: unknown) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes))
    return [];
  return Object.entries(changes)
    .filter(([key]) => !/id|hash|token|secret|payload|correlation/i.test(key))
    .map(([key, value]) => ({
      label: ruleLabel(key),
      value: /redacted|private/i.test(String(value))
        ? "Private information hidden"
        : displayValue(value),
    }));
}
export function activityCsv(
  records: {
    createdAt: string;
    action: string;
    actorRole: string;
    outcome: string;
    reason?: string | null;
  }[],
) {
  const cell = (value: string) =>
    `"${(/^[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  return (
    "\ufeff" +
    [
      ["Date (Malaysia time)", "Activity", "Staff role", "Outcome", "Note"],
      ...records.map((r) => [
        new Date(r.createdAt).toLocaleString("en-MY", {
          timeZone: "Asia/Kuala_Lumpur",
        }),
        activityLabel(r.action),
        friendlyLabel(r.actorRole),
        friendlyLabel(r.outcome),
        r.reason ?? "",
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
