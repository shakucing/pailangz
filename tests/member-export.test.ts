import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberExportRow } from "../src/lib/member-export";
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
  decrypt: vi.fn(),
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
vi.mock("../src/lib/crypto", () => ({ decrypt: mocks.decrypt }));
vi.mock("../src/lib/imports", () => ({
  DEFAULT_MAPPING: { country: "Country" },
}));

import { membersCsv, membersXlsx } from "../src/lib/member-export";
import { memberDirectoryWhere } from "../src/lib/member-directory";
import { POST } from "../src/app/api/staff/members/export/route";

const member: MemberExportRow = {
  displayIgn: '玩家, "Alpha"\nSecond line',
  isLiveStreamer: true,
  createdAt: new Date("2026-09-30T12:24:10Z"),
  fields: {
    Timestamp: "9/30/2026 20:24:10",
    IGN: "Old name",
    "Whatsapp Number": "Old phone",
    "Tiktok username": "alpha77",
    "Tiktok ID": "0007",
    "Discord Name": "Alpha",
    "Discord ID": "00123456789012345678",
    "State/Province": "Kuala Lumpur",
    Country: "MY",
    status: "active",
    "Is Live Streamer": "No",
  },
  phone: "0182195485",
  country: "Malaysia",
};
const record = {
  id: "member-1",
  displayIgn: member.displayIgn,
  isLiveStreamer: member.isLiveStreamer,
  createdAt: member.createdAt,
  privateData: {
    registrationEncrypted: JSON.stringify(member.fields),
    phoneEncrypted: member.phone,
  },
};
const expectedHeaders = [
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
const expectedValues = [
  "9/30/2026 20:24:10",
  member.displayIgn,
  "0182195485",
  "alpha77",
  "0007",
  "Alpha",
  "00123456789012345678",
  "Kuala Lumpur",
  "Malaysia",
  "active",
  "Yes",
];
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
  mocks.findMany.mockResolvedValue([record]);
  mocks.decrypt.mockImplementation((value: string) => value);
  mocks.findUnique.mockResolvedValue(null);
});

describe("member download formats", () => {
  it("matches the registration columns and round-trips full details", () => {
    const csv = membersCsv([member]);
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(parse(csv, { bom: true })).toEqual([
      expectedHeaders,
      expectedValues,
    ]);
    expect(parse(membersCsv([]), { bom: true })).toEqual([expectedHeaders]);
  });

  it("leaves missing registration details blank and uses the member creation timestamp", () => {
    const rows = parse(
      membersCsv([
        {
          ...member,
          fields: {},
          phone: null,
          country: "",
          isLiveStreamer: false,
        },
      ]),
      { bom: true },
    );
    expect(rows[1]).toEqual([
      member.createdAt.toISOString(),
      member.displayIgn,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "No",
    ]);
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
    expect(rows[1][1]).toBe(`'${displayIgn}`);
  });

  it("writes a real XLSX with text cells, preserved codes and no executable formulas", async () => {
    const workbook = new ExcelJS.Workbook();
    const bytes = await membersXlsx([{ ...member, displayIgn: "=1+1" }]);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    await workbook.xlsx.load(bytes.buffer);
    const sheet = workbook.getWorksheet("Members")!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(1).values).toEqual([undefined, ...expectedHeaders]);
    expect(sheet.getCell("B2").value).toBe("=1+1");
    expect(sheet.getCell("B2").type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell("E2").value).toBe("0007");
    expect(sheet.getCell("C2").value).toBe("0182195485");
    expect(sheet.getCell("G2").value).toBe("00123456789012345678");
    expect(sheet.getCell("K2").value).toBe("Yes");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:K2");
  });
});

describe("member export access and filters", () => {
  it("requires an admin and exports all filtered rows across pages with an audit event", async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: 61 }, (_, i) => ({ ...record, id: `member-${i}` })),
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
        privateData: {
          select: { registrationEncrypted: true, phoneEncrypted: true },
        },
      },
    });
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty("take");
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty("skip");
    expect(parse(await response.text(), { bom: true })).toHaveLength(62);
    expect(mocks.decrypt).toHaveBeenCalledWith(
      record.privateData.registrationEncrypted,
      "member:member-0",
    );
    expect(mocks.decrypt).toHaveBeenCalledWith(
      record.privateData.phoneEncrypted,
      "member-phone:member-0",
    );
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
      { recordCount: 61, format: "csv", includesPrivateDetails: true },
    );
  });

  it("uses current member details and the configured country mapping in CSV", async () => {
    mocks.findUnique.mockResolvedValue({ value: { country: "Residence" } });
    mocks.findMany.mockResolvedValue([
      {
        ...record,
        privateData: {
          ...record.privateData,
          registrationEncrypted: JSON.stringify({
            ...member.fields,
            Country: "Indonesia",
            Residence: "MY",
          }),
        },
      },
    ]);
    const response = await POST(request({ format: "csv" }));
    expect(response.status).toBe(200);
    expect(parse(await response.text(), { bom: true })).toEqual([
      expectedHeaders,
      expectedValues,
    ]);
  });

  it("exports members without private records with blank contact and social fields", async () => {
    mocks.findMany.mockResolvedValue([{ ...record, privateData: null }]);
    const response = await POST(request({ format: "csv" }));
    expect(response.status).toBe(200);
    expect(parse(await response.text(), { bom: true })[1]).toEqual([
      member.createdAt.toISOString(),
      member.displayIgn,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Yes",
    ]);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("does not restore a removed phone from stale registration answers", async () => {
    mocks.findMany.mockResolvedValue([
      {
        ...record,
        privateData: { ...record.privateData, phoneEncrypted: null },
      },
    ]);
    const response = await POST(request({ format: "csv" }));
    expect(parse(await response.text(), { bom: true })[1][2]).toBe("");
  });

  it("does not return a partial download or audit success when decryption fails", async () => {
    mocks.decrypt.mockImplementation(() => {
      throw new Error("private crypto detail");
    });
    const response = await POST(request({ format: "csv" }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private crypto detail");
    expect(mocks.audit).not.toHaveBeenCalled();
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
    expect(workbook.getWorksheet("Members")!.getCell("B2").value).toBe(
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
