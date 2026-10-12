import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRow } from "../src/components/member-workspace";
import type { Tx } from "../src/lib/db";
import { DomainError } from "../src/lib/domain";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  assertCsrf: vi.fn(),
  rateLimit: vi.fn(),
  audit: vi.fn(),
  privateTx: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("../src/lib/auth", () => ({
  getActor: mocks.getActor,
  assertCsrf: mocks.assertCsrf,
}));
vi.mock("../src/lib/db", () => ({
  rateLimit: mocks.rateLimit,
  audit: mocks.audit,
  privateTx: mocks.privateTx,
}));
vi.mock("../src/lib/crypto", () => ({ decrypt: (value: string) => value }));
vi.mock("../src/lib/imports", () => ({
  DEFAULT_MAPPING: { country: "Country" },
}));

import { membersCsv, membersXlsx } from "../src/lib/member-export";
import { memberDirectoryWhere } from "../src/lib/member-directory";
import { POST } from "../src/app/api/staff/members/export/route";

const member: MemberRow = {
  id: "member-1",
  displayIgn: '玩家, "Alpha"\nSecond line',
  verified: true,
  archived: false,
  isLiveStreamer: true,
  privateData: { phoneLastFour: "0012", phoneIssue: null },
  participants: [
    {
      id: "entry-1",
      code: "0007",
      eligible: false,
      tournament: { name: "Tournament A", published: false },
    },
  ],
};
const tx = {
  member: { findMany: mocks.findMany },
  integrationSetting: { findUnique: mocks.findUnique },
} as unknown as Tx;

function request(body: unknown) {
  return new Request("http://localhost:3000/api/staff/members/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getActor.mockResolvedValue({ id: "admin", role: "ADMIN" });
  mocks.privateTx.mockImplementation((_actor, callback) => callback(tx));
  mocks.findMany.mockResolvedValue([member]);
  mocks.findUnique.mockResolvedValue(null);
});

describe("member download formats", () => {
  it("round-trips Unicode, commas, quotes and newlines with masked phones", () => {
    const csv = membersCsv([member]);
    expect(csv.startsWith("\ufeff")).toBe(true);
    const rows = parse(csv, { bom: true });
    expect(rows[1]).toEqual([
      member.displayIgn,
      "0007",
      "Approved",
      "Yes",
      "•••• 0012",
      "",
      "Tournament A (0007) · Awaiting approval · Draft",
    ]);
    expect(
      membersCsv([
        { ...member, privateData: null, participants: [], verified: false },
      ]),
    ).toContain('"Not supplied"');
    expect(membersCsv([{ ...member, archived: true }])).toContain('"Archived"');
    expect(parse(membersCsv([]), { bom: true })).toHaveLength(1);
  });

  it.each([
    "=SUM(1,2)",
    "+123",
    "-123",
    "@SUM(A1)",
    " \t=1+1",
    "\r=1",
    "\tname",
  ])("exports formula-like text safely in CSV: %j", (displayIgn) => {
    const rows = parse(membersCsv([{ ...member, displayIgn }]), { bom: true });
    expect(rows[1][0]).toBe(`'${displayIgn}`);
  });

  it("writes a real XLSX with text cells, preserved codes and no executable formulas", async () => {
    const workbook = new ExcelJS.Workbook();
    const bytes = await membersXlsx([{ ...member, displayIgn: "=1+1" }]);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    await workbook.xlsx.load(bytes.buffer);
    const sheet = workbook.getWorksheet("Members")!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell("A2").value).toBe("=1+1");
    expect(sheet.getCell("A2").type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell("B2").value).toBe("0007");
    expect(sheet.getCell("E2").value).toBe("•••• 0012");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:G2");
  });
});

describe("member export access and filters", () => {
  it("requires an admin and exports all filtered rows across pages with an audit event", async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: 61 }, (_, i) => ({ ...member, id: `member-${i}` })),
    );
    const response = await POST(
      request({ format: "csv", state: "pending", q: "Alpha" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.getActor).toHaveBeenCalledWith("ADMIN");
    expect(mocks.assertCsrf).toHaveBeenCalled();
    expect(mocks.rateLimit).toHaveBeenCalledWith("member-export:admin", 5, 600);
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({
      where: { archived: false, verified: false, OR: expect.any(Array) },
      orderBy: { displayIgn: "asc" },
      select: {
        privateData: { select: { phoneLastFour: true, phoneIssue: true } },
        participants: { where: { withdrawn: false } },
      },
    });
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty("take");
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty("skip");
    expect(parse(await response.text(), { bom: true })).toHaveLength(62);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "pailangz-members.csv",
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      expect.any(Object),
      "MEMBER_EXPORT",
      "MEMBER",
      "bulk",
      { recordCount: 61, format: "csv" },
    );
  });

  it("serves a valid Excel attachment", async () => {
    const response = await POST(request({ format: "xlsx", state: "archived" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toContain(
      "pailangz-members.xlsx",
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.getWorksheet("Members")!.getCell("A2").value).toBe(
      member.displayIgn,
    );
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ archived: true });
  });

  it.each([401, 403])(
    "denies unauthorized callers (%i) before reading member data",
    async (status) => {
      mocks.getActor.mockRejectedValue(
        new DomainError("Access denied", status),
      );
      expect((await POST(request({ format: "csv" }))).status).toBe(status);
      expect(mocks.privateTx).not.toHaveBeenCalled();
    },
  );

  it("denies cross-origin requests before authentication or reading data", async () => {
    mocks.assertCsrf.mockRejectedValue(
      new DomainError("Invalid request origin.", 403),
    );
    expect((await POST(request({ format: "csv" }))).status).toBe(403);
    expect(mocks.getActor).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it.each([
    { format: "xls" },
    { format: "csv", state: "unknown" },
    { format: "csv", q: "x".repeat(101) },
  ])("rejects invalid export inputs: %j", async (input) => {
    expect((await POST(request(input))).status).toBe(400);
    expect(mocks.privateTx).not.toHaveBeenCalled();
  });

  it("applies encrypted country answers and custom mappings before pagination", async () => {
    mocks.findUnique.mockResolvedValue({ value: { country: "Residence" } });
    mocks.findMany.mockResolvedValue([
      {
        id: "my",
        privateData: {
          registrationEncrypted: JSON.stringify({ Residence: "Malaysia" }),
        },
      },
      {
        id: "id",
        privateData: {
          registrationEncrypted: JSON.stringify({ Country: "Indonesia" }),
        },
      },
      { id: "empty", privateData: null },
    ]);
    expect(
      await memberDirectoryWhere(tx, { state: "all", country: "MY" }),
    ).toEqual({ id: { in: ["my"] } });
    expect(await memberDirectoryWhere(tx, { country: "unspecified" })).toEqual({
      archived: false,
      id: { in: ["empty"] },
    });
    expect(await memberDirectoryWhere(tx, { country: "JP" })).toEqual({
      archived: false,
      id: { in: [] },
    });
  });

  it("returns a recoverable error without leaking internal errors", async () => {
    mocks.findMany.mockRejectedValue(new Error("sensitive connection detail"));
    const response = await POST(request({ format: "csv" }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("sensitive");
  });
});
