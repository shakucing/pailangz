import type { Tx } from "./db";
import { countryCode } from "./countries";
import { decrypt } from "./crypto";
import { DEFAULT_MAPPING } from "./imports";
import { isNonFamily } from "./member-fields";

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
  isMember: true,
  isLiveStreamer: true,
  privateData: {
    select: {
      phoneLastFour: true,
      phoneIssue: true,
      registrationEncrypted: true,
    },
  },
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
  let matchingIds: string[] | undefined;
  if (country || state !== "all") {
    // Private answers are encrypted. Match all candidates before pagination
    // so counts, pages and exports use the same non-family/country filters.
    const [candidates, setting] = await Promise.all([
      tx.member.findMany({
        where,
        select: {
          id: true,
          isMember: true,
          verified: true,
          privateData: { select: { registrationEncrypted: true } },
        },
      }),
      tx.integrationSetting.findUnique({ where: { key: "formMapping" } }),
    ]);
    const countryField =
      (setting?.value as { country?: string } | undefined)?.country ??
      DEFAULT_MAPPING.country;
    matchingIds = candidates
      .filter((member) => {
        const fields = member.privateData
          ? (JSON.parse(
              decrypt(
                member.privateData.registrationEncrypted,
                `member:${member.id}`,
              ),
            ) as Record<string, string>)
          : {};
        // Retain the original non-family answer on older encrypted profiles.
        // Staff membership changes synchronize both representations.
        const hasMembership = member.isMember && !isNonFamily(fields);
        if (
          state === "non-members"
            ? hasMembership
            : state !== "all" && !hasMembership
        )
          return false;
        if (!country) return true;
        const value = fields[countryField] ?? fields.Country ?? "";
        return country === "unspecified"
          ? !value.trim()
          : countryCode(value) === country;
      })
      .map((member) => member.id);
  }
  return {
    ...where,
    ...(matchingIds ? { id: { in: matchingIds } } : {}),
  };
}
