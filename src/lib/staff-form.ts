import {
  malaysiaDateSubmission,
  ruleFields,
  sizeFields,
} from "./staff-presentation";

export type FormField = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  pairCount?: number;
  matchesPerPlayer?: number;
  options?: { value: string; label: string }[];
};
export function staffFormData(
  fields: FormField[],
  form: FormData,
  fixed: Record<string, unknown> = {},
) {
  const data = { ...fixed };
  for (const f of fields) {
    const value = String(form.get(f.name) ?? "");
    if (f.type === "configuration") {
      data[f.name] = {
        scheduleSource: "generated",
        ...Object.fromEntries(
          sizeFields.map(([key]) => [key, Number(form.get(key))]),
        ),
        leagueByePolicy: form.get("leagueByePolicy"),
        bracketByePolicy: form.get("bracketByePolicy"),
      };
    } else if (f.type === "rules") {
      const rules = JSON.parse(
        String(form.get("previousRules") ?? "{}"),
      ) as Record<string, unknown>;
      const oldConfirmed = JSON.parse(
        String(form.get("previousConfirmed") ?? "[]"),
      ) as string[];
      const edited: string[] = [];
      for (const field of ruleFields) {
        if (!form.has(`rule:${field.key}`)) continue;
        edited.push(field.key);
        const v = String(form.get(`rule:${field.key}`) ?? "");
        if (!v.trim()) {
          delete rules[field.key];
          continue;
        }
        rules[field.key] = field.order
          ? JSON.parse(v)
          : ["seriesPoints", "qualificationCarry"].includes(field.key)
            ? v === "true"
            : field.key === "qualificationBestOf"
              ? Number(v)
              : v;
      }
      const confirmed = [
        ...oldConfirmed.filter((key) => !edited.includes(key)),
        ...form.getAll("confirmedRules").map(String),
      ];
      for (const key of confirmed)
        if (
          !(key in rules) ||
          (Array.isArray(rules[key]) && !(rules[key] as unknown[]).length)
        )
          throw new Error(
            `Choose ${ruleFields.find((r) => r.key === key)?.label.toLowerCase() ?? "a rule"} before confirming it.`,
          );
      data.rules = rules;
      data.confirmedRules = confirmed;
    } else if (f.type === "mapping") {
      data[f.name] = Object.fromEntries(
        ["ign", "phone", "country"].map((key) => [
          key,
          String(form.get(`mapping:${key}`) ?? "").trim(),
        ]),
      );
    } else if (["members", "ordered", "pairs"].includes(f.type ?? "")) {
      const items = JSON.parse(value || "[]") as string[] | string[][];
      if (f.type === "pairs") {
        const pairs = items as string[][];
        if (
          pairs.length !== f.pairCount ||
          pairs.some((p) => p.length !== 2 || !p[0] || !p[1] || p[0] === p[1])
        )
          throw new Error("Choose two different players for every match.");
        if (
          new Set(pairs.map((p) => [...p].sort().join(":"))).size !==
          pairs.length
        )
          throw new Error(
            "Two players cannot face each other more than once. Check the pairings.",
          );
        if (
          f.matchesPerPlayer &&
          f.options?.some(
            (o) =>
              pairs.flat().filter((id) => id === o.value).length !==
              f.matchesPerPlayer,
          )
        )
          throw new Error(
            `Give each player exactly ${f.matchesPerPlayer} matches.`,
          );
      } else {
        if (new Set(items as string[]).size !== items.length)
          throw new Error("Choose each player or team only once.");
        if (
          (f.required && !items.length) ||
          (f.min !== undefined && items.length < f.min)
        )
          throw new Error(`Please complete ${f.label.toLowerCase()}.`);
        if (f.max !== undefined && items.length > f.max)
          throw new Error(`Choose no more than ${f.max} players.`);
      }
      data[f.name] = items;
    } else {
      data[f.name] =
        f.type === "checkbox"
          ? form.has(f.name)
          : f.type === "datetime-local"
            ? malaysiaDateSubmission(value)
            : value;
      if (
        !value &&
        f.type !== "checkbox" &&
        !f.required &&
        !["overviewEn", "titleEn", "bodyEn"].includes(f.name)
      )
        delete data[f.name];
    }
  }
  return data;
}
