import ExcelJS from "exceljs";

export type MemberExportRow = {
  displayIgn: string;
  isLiveStreamer: boolean;
  createdAt: Date;
  fields: Record<string, string>;
  phone: string | null;
  country: string;
};

const HEADERS = [
  "Timestamp",
  "IGN",
  "Whatsapp Number",
  "Tiktok username",
  "Tiktok ID",
  "Discord Name",
  "Discord ID",
  "State/Province",
  "Country",
  "status",
  "Is Live Streamer",
];

function memberValues(member: MemberExportRow) {
  return [
    member.fields.Timestamp || member.createdAt.toISOString(),
    member.displayIgn,
    member.phone ?? "",
    member.fields["Tiktok username"] ?? "",
    member.fields["Tiktok ID"] ?? "",
    member.fields["Discord Name"] ?? "",
    member.fields["Discord ID"] ?? "",
    member.fields["State/Province"] ?? "",
    member.country,
    member.fields.status ?? "",
    member.isLiveStreamer ? "Yes" : "No",
  ];
}

export function membersCsv(members: MemberExportRow[]) {
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

export async function membersXlsx(members: MemberExportRow[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Members", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = HEADERS.map((header, index) => ({
    header,
    width: [26, 28, 24, 24, 24, 28, 24, 24, 24, 16, 22][index],
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
