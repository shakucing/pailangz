import ExcelJS from "exceljs";
import type { MemberRow } from "@/components/member-workspace";

const HEADERS = [
  "Member",
  "Player codes",
  "Status",
  "Is Live Streamer",
  "Phone (masked)",
  "Phone review",
  "Tournament entries",
];

function memberValues(member: MemberRow) {
  return [
    member.displayIgn,
    member.participants.map((p) => p.code).join(" · "),
    member.archived
      ? "Archived"
      : member.verified
        ? "Approved"
        : "Awaiting approval",
    member.isLiveStreamer ? "Yes" : "No",
    member.privateData?.phoneLastFour
      ? `•••• ${member.privateData.phoneLastFour}`
      : "Not supplied",
    member.privateData?.phoneIssue ? "Needs checking" : "",
    member.participants
      .map(
        (p) =>
          `${p.tournament.name} (${p.code}) · ${p.eligible ? "Approved" : "Awaiting approval"} · ${p.tournament.published ? "Published" : "Draft"}`,
      )
      .join("\n"),
  ];
}

export function membersCsv(members: MemberRow[]) {
  const cell = (value: string) => {
    // Quote all fields and neutralize spreadsheet formulas, including those
    // preceded by whitespace/control characters in imported names.
    const safe =
      /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value)
        ? `'${value}`
        : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    "\ufeff" +
    [HEADERS, ...members.map(memberValues)]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}

export async function membersXlsx(members: MemberRow[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Members", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = HEADERS.map((header, index) => ({
    header,
    width: [28, 26, 22, 20, 20, 20, 70][index],
    style: { numFmt: "@", alignment: { vertical: "top", wrapText: true } },
  }));
  // Explicit string values preserve codes/leading zeros and never create formulas.
  sheet.addRows(members.map(memberValues));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = {
    from: "A1",
    to: { row: sheet.rowCount, column: HEADERS.length },
  };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
