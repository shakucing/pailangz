import { COUNTRY_OPTIONS, countryCode } from "./countries";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

type MemberFieldKind = "country" | "status";

export function memberFieldKind(
  key: string,
  countryField = "Country",
): MemberFieldKind | undefined {
  if (key === countryField || key.trim().toLowerCase() === "country")
    return "country";
  if (key.trim().toLowerCase() === "status") return "status";
}

export function normalizeMemberField(kind: MemberFieldKind, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (kind === "country") return countryCode(trimmed);
  return STATUS_OPTIONS.find((option) => option.value === trimmed.toLowerCase())
    ?.value;
}

export function memberFieldOptions(kind: MemberFieldKind, current: string) {
  const normalized = normalizeMemberField(kind, current);
  const choices = [
    { value: "", label: "Not specified" },
    ...(kind === "country" ? COUNTRY_OPTIONS : STATUS_OPTIONS),
  ];
  // Keep the saved spelling for the current choice so unrelated edits don't
  // rewrite imported data. An unknown legacy value may only be kept as-is.
  if (normalized === undefined)
    return [
      { value: current, label: `Current value: ${current} (unrecognized)` },
      ...choices,
    ];
  return choices.map((option) => ({
    ...option,
    value: option.value === normalized ? current : option.value,
  }));
}
