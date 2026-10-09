export const staffNavigationGroups = [
  {
    id: "registration",
    label: "Registrations",
    adminOnly: false,
    items: [
      ["registrations", "Registration inbox"],
      ["members", "Members"],
      ["imports", "Registration uploads"],
    ],
  },
  {
    id: "competition",
    label: "Competition",
    adminOnly: false,
    items: [
      ["tournaments", "Tournaments & rules"],
      ["participation", "Tournament participation"],
      ["teams", "Team rosters"],
      ["matches", "Fixtures & results"],
    ],
  },
  {
    id: "workspace",
    label: "Workspace activity",
    adminOnly: false,
    items: [
      ["content", "Announcements"],
      ["audit", "Activity history"],
    ],
  },
  {
    id: "administration",
    label: "Administration",
    adminOnly: true,
    items: [
      ["settings", "Registration settings"],
      ["staff", "Staff accounts"],
    ],
  },
] as const;

type GroupNavigationItem =
  (typeof staffNavigationGroups)[number]["items"][number];

export const staffNavigation = [
  ["overview", "Overview"],
  ...staffNavigationGroups.flatMap<GroupNavigationItem>((group) => group.items),
] as const;

export type StaffNavigationKey = (typeof staffNavigation)[number][0];

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
