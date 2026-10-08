export const staffNavigation = [
  ["overview", "Overview"],
  ["registrations", "Registration inbox"],
  ["participation", "Tournament participation"],
  ["members", "Members"],
  ["tournaments", "Tournaments & rules"],
  ["teams", "Team rosters"],
  ["matches", "Fixtures & results"],
  ["content", "Announcements"],
  ["imports", "Registration uploads"],
  ["audit", "Activity history"],
  ["settings", "Registration settings"],
  ["staff", "Staff accounts"],
] as const;

export async function staffPageMetadata({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  return {
    title:
      staffNavigation.find(([key]) => key === (path?.[0] ?? "overview"))?.[1] ??
      "Staff workspace",
  };
}
