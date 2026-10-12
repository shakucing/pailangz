import { z } from "zod";
import { assertCsrf, getActor } from "@/lib/auth";
import { audit, privateTx, rateLimit } from "@/lib/db";
import { DomainError } from "@/lib/domain";
import { boundedJson } from "@/lib/request-body";
import { memberDirectoryWhere } from "@/lib/member-directory";
import { decrypt } from "@/lib/crypto";
import { DEFAULT_MAPPING } from "@/lib/imports";
import { COUNTRY_OPTIONS, countryCode } from "@/lib/countries";
import { membersCsv, membersXlsx } from "@/lib/member-export";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
const input = z.object({
  format: z.enum(["csv", "xlsx"]),
  state: z.enum(["active", "pending", "archived", "all"]).default("active"),
  q: z.string().max(100).default(""),
  country: z.string().max(100).default(""),
});

export async function POST(request: Request) {
  try {
    await assertCsrf(request);
    const actor = await getActor("ADMIN");
    const filters = input.parse(await boundedJson(request, 4096));
    await rateLimit(`member-export:${actor.id}`, 5, 600);
    const members = await privateTx(actor, async (tx) => {
      const where = await memberDirectoryWhere(tx, filters);
      const [records, setting] = await Promise.all([
        tx.member.findMany({
          where,
          orderBy: { displayIgn: "asc" },
          select: {
            id: true,
            displayIgn: true,
            isLiveStreamer: true,
            createdAt: true,
            privateData: {
              select: { registrationEncrypted: true, phoneEncrypted: true },
            },
          },
        }),
        tx.integrationSetting.findUnique({ where: { key: "formMapping" } }),
      ]);
      const countryField =
        (setting?.value as { country?: string } | undefined)?.country ??
        DEFAULT_MAPPING.country;
      const rows = records.map((member) => {
        const fields = member.privateData
          ? (JSON.parse(
              decrypt(
                member.privateData.registrationEncrypted,
                `member:${member.id}`,
              ),
            ) as Record<string, string>)
          : {};
        const rawCountry = fields[countryField] ?? fields.Country ?? "";
        const code = countryCode(rawCountry);
        return {
          displayIgn: member.displayIgn,
          isLiveStreamer: member.isLiveStreamer,
          createdAt: member.createdAt,
          fields,
          phone: member.privateData?.phoneEncrypted
            ? decrypt(
                member.privateData.phoneEncrypted,
                `member-phone:${member.id}`,
              )
            : null,
          country:
            COUNTRY_OPTIONS.find((option) => option.value === code)?.label ??
            rawCountry,
        };
      });
      await audit(tx, actor, "MEMBER_EXPORT", "MEMBER", "bulk", {
        recordCount: records.length,
        format: filters.format,
        includesPrivateDetails: true,
      });
      return rows;
    });
    const body =
      filters.format === "csv"
        ? membersCsv(members)
        : await membersXlsx(members);
    return new Response(body, {
      headers: {
        ...headers,
        "Content-Type":
          filters.format === "csv"
            ? "text/csv;charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="pailangz-members.${filters.format}"`,
      },
    });
  } catch (error) {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 500;
    const message =
      error instanceof DomainError
        ? error.message
        : error instanceof z.ZodError
          ? "Please check the download format and member filters."
          : "Unable to download members. Please try again.";
    return Response.json({ error: message }, { status, headers });
  }
}
