import type { Tx } from "./db";
import { countryCode } from "./countries";
import { decrypt } from "./crypto";
import { DEFAULT_MAPPING } from "./imports";

type Query = Record<string, string | undefined>;

export function memberFilters(q: Query) {
  return {
    state: q.state ?? "active",
    search: q.q?.slice(0, 100),
    country:
      q.country === "unspecified"
        ? "unspecified"
        : (countryCode(q.country ?? "") ?? ""),
  };
}

export const MEMBER_DIRECTORY_SELECT = {
  id: true,
  displayIgn: true,
  verified: true,
  archived: true,
  isLiveStreamer: true,
  privateData: { select: { phoneLastFour: true, phoneIssue: true } },
  participants: {
    where: { withdrawn: false },
    select: {
      id: true,
      code: true,
      eligible: true,
      tournament: { select: { name: true, published: true } },
    },
  },
} as const;

export async function memberDirectoryWhere(tx: Tx, q: Query) {
  const { state, search, country } = memberFilters(q);
  const where = {
    ...(state === "archived"
      ? { archived: true }
      : state === "all"
        ? {}
        : { archived: false }),
    ...(state === "pending" ? { verified: false } : {}),
    ...(search
      ? {
          OR: [
            { displayIgn: { contains: search, mode: "insensitive" as const } },
            {
              participants: {
                some: {
                  code: { contains: search, mode: "insensitive" as const },
                },
              },
            },
            { privateData: { phoneLastFour: { contains: search } } },
          ],
        }
      : {}),
  };
  let countryIds: string[] | undefined;
  if (country) {
    // Country answers are encrypted. Match the full candidate set on the
    // server before applying pagination, including imported country names.
    const [candidates, setting] = await Promise.all([
      tx.member.findMany({
        where,
        select: {
          id: true,
          privateData: { select: { registrationEncrypted: true } },
        },
      }),
      tx.integrationSetting.findUnique({ where: { key: "formMapping" } }),
    ]);
    const countryField =
      (setting?.value as { country?: string } | undefined)?.country ??
      DEFAULT_MAPPING.country;
    countryIds = candidates
      .filter((member) => {
        const fields = member.privateData
          ? (JSON.parse(
              decrypt(
                member.privateData.registrationEncrypted,
                `member:${member.id}`,
              ),
            ) as Record<string, string>)
          : {};
        const value = fields[countryField] ?? fields.Country ?? "";
        return country === "unspecified"
          ? !value.trim()
          : countryCode(value) === country;
      })
      .map((member) => member.id);
  }
  return {
    ...where,
    ...(countryIds ? { id: { in: countryIds } } : {}),
  };
}
