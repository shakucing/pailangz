import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { putEvidence, getEvidence } from "../src/lib/evidence";
import { decrypt } from "../src/lib/crypto";
import { DomainError } from "../src/lib/domain";
import {
  MAX_EVIDENCE_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
} from "../src/lib/evidence-policy";
import {
  evidenceStorageConfig,
  getStoredEvidence,
} from "../src/lib/evidence-storage";
import { storageVariables } from "../scripts/check-evidence-storage";
import type { Actor } from "../src/lib/db";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
  configuration: vi.fn(),
  privateTx: vi.fn(),
  audit: vi.fn(),
  result: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
}));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-s3")>()),
  S3Client: class {
    constructor(options: unknown) {
      mocks.configuration(options);
    }
    send = mocks.send;
    destroy = mocks.destroy;
  },
}));
vi.mock("../src/lib/db", () => ({
  privateTx: mocks.privateTx,
  audit: mocks.audit,
}));

const actor: Actor = {
  id: "staff",
  role: "MODERATOR",
  sessionId: "session",
  authenticatedAt: new Date(),
};
const submitted = {
  status: "SUBMITTED",
  match: { round: { stage: { archived: false } } },
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=",
  "base64",
);
const objects = new Map<string, string>();
let metadata:
  { id: string; storageKey: string; mime: string; size: number } | undefined;
const config = {
  S3_ENDPOINT: "https://branch.storage.example.invalid",
  S3_REGION: "ap-southeast-1",
  S3_BUCKET: "synthetic-evidence",
  S3_ACCESS_KEY_ID: "synthetic-access",
  S3_SECRET_ACCESS_KEY: "synthetic-secret",
};

beforeEach(() => {
  vi.resetAllMocks();
  objects.clear();
  metadata = undefined;
  for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
  vi.stubEnv("EVIDENCE_STORAGE", "s3");
  vi.stubEnv(
    "DATA_ENCRYPTION_KEYS",
    JSON.stringify({ test: randomBytes(32).toString("base64") }),
  );
  vi.stubEnv("ACTIVE_ENCRYPTION_KEY", "test");
  const tx = {
    resultVersion: { findUniqueOrThrow: mocks.result },
    evidence: { create: mocks.create, findUniqueOrThrow: mocks.find },
  };
  mocks.privateTx.mockImplementation(async (_actor, work) => work(tx));
  mocks.result.mockResolvedValue(submitted);
  mocks.create.mockImplementation(async ({ data }) => {
    metadata = { ...data, id: "evidence" };
    return metadata;
  });
  mocks.find.mockImplementation(async () => metadata);
  mocks.send.mockImplementation(async (command) => {
    const { Key } = command.input;
    if (command instanceof PutObjectCommand)
      objects.set(Key, command.input.Body as string);
    else if (command instanceof DeleteObjectCommand) objects.delete(Key);
    else if (command instanceof GetObjectCommand)
      return { Body: { transformToString: async () => objects.get(Key) } };
    return {};
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("private evidence uploads", () => {
  it("stores ciphertext under an opaque key and downloads the original screenshot with audit events", async () => {
    const uploaded = await putEvidence(
      actor,
      "result",
      new File([png], "private-player-name.png"),
    );
    expect(uploaded).toEqual({ id: "evidence" });
    const [key, ciphertext] = [...objects][0];
    expect(key).toMatch(/^[a-f0-9-]{36}$/);
    expect(ciphertext).not.toContain(png.toString("base64"));
    expect(decrypt(ciphertext, `evidence:${key}`)).toBe(png.toString("base64"));
    expect(() => decrypt(ciphertext, "evidence:another-key")).toThrow();
    expect(metadata).toMatchObject({
      size: png.length,
      mime: "image/png",
      uploadedBy: actor.id,
    });
    const download = await getEvidence(actor, uploaded.id);
    expect(download.bytes).toEqual(png);
    expect(download.mime).toBe("image/png");
    expect(mocks.audit.mock.calls.map((call) => call[2])).toEqual([
      "EVIDENCE_UPLOAD",
      "EVIDENCE_DOWNLOAD",
    ]);
    expect(mocks.configuration).toHaveBeenCalledWith(
      expect.objectContaining({
        forcePathStyle: true,
        requestChecksumCalculation: "WHEN_REQUIRED",
      }),
    );
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });

  it("accepts the largest supported screenshot, with room for multipart fields below Vercel's limit", async () => {
    const bytes = Buffer.alloc(MAX_EVIDENCE_BYTES);
    png.copy(bytes);
    await putEvidence(actor, "result", new File([bytes], "large.png"));
    expect(metadata?.size).toBe(MAX_EVIDENCE_BYTES);
    expect((await getEvidence(actor, "evidence")).bytes.equals(bytes)).toBe(true);
    expect(MAX_UPLOAD_REQUEST_BYTES).toBeLessThan(4_500_000);
    const form = new FormData();
    form.set("action", "evidence");
    form.set("resultId", "7aeb047c-8472-43d9-ae26-7fc9f6fda991");
    form.set("file", new File([bytes], "large.png"));
    expect(
      (
        await new Request("https://example.invalid", {
          method: "POST",
          body: form,
        }).arrayBuffer()
      ).byteLength,
    ).toBeLessThan(MAX_UPLOAD_REQUEST_BYTES);
  });

  it("rejects an oversized or empty file before accessing storage or the database", async () => {
    for (const file of [
      new File([Buffer.alloc(MAX_EVIDENCE_BYTES + 1)], "large.png"),
      new File([], "empty.png"),
    ])
      await expect(putEvidence(actor, "result", file)).rejects.toBeInstanceOf(
        DomainError,
      );
    expect(mocks.privateTx).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects a renamed non-image based on its bytes", async () => {
    await expect(
      putEvidence(
        actor,
        "result",
        new File(["<html>fake</html>"], "fake.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("PNG, JPEG or WebP");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    ["jpeg", Buffer.from([255, 216, 255, 224]), "image/jpeg"],
    ["webp", Buffer.from("RIFFxxxxWEBP"), "image/webp"],
  ])(
    "recognizes %s by signature instead of the supplied MIME type",
    async (_extension, bytes, mime) => {
      await putEvidence(
        actor,
        "result",
        new File([bytes], "evidence.bin", { type: "text/plain" }),
      );
      expect(metadata?.mime).toBe(mime);
    },
  );

  it.each([
    { ...submitted, status: "ACCEPTED" },
    { ...submitted, match: { round: { stage: { archived: true } } } },
  ])(
    "rejects uploads to an accepted result or archived stage",
    async (result) => {
      mocks.result.mockResolvedValue(result);
      await expect(
        putEvidence(actor, "result", new File([png], "a.png")),
      ).rejects.toThrow("submitted result in a current stage");
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );

  it("removes the stored object when the result changes during upload", async () => {
    mocks.result
      .mockResolvedValueOnce(submitted)
      .mockResolvedValueOnce({ ...submitted, status: "ACCEPTED" });
    await expect(
      putEvidence(actor, "result", new File([png], "a.png")),
    ).rejects.toThrow("changed while uploading");
    expect(objects.size).toBe(0);
    expect(mocks.send.mock.calls[1][0]).toBeInstanceOf(DeleteObjectCommand);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("removes the object if saving metadata fails", async () => {
    mocks.create.mockRejectedValue(new Error("synthetic database failure"));
    await expect(
      putEvidence(actor, "result", new File([png], "a.png")),
    ).rejects.toThrow("synthetic database failure");
    expect(objects.size).toBe(0);
  });

  it("does not upload or read objects when the private transaction denies access", async () => {
    mocks.privateTx.mockRejectedValue(new DomainError("Access denied", 403));
    await expect(
      putEvidence(actor, "result", new File([png], "a.png")),
    ).rejects.toThrow("Access denied");
    await expect(getEvidence(actor, "evidence")).rejects.toThrow(
      "Access denied",
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("refuses local filesystem storage in production", async () => {
    vi.stubEnv("EVIDENCE_STORAGE", "local");
    vi.stubEnv("APP_ENV", "production");
    await expect(
      putEvidence(actor, "result", new File([png], "a.png")),
    ).rejects.toThrow("storage is not connected");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("S3 and Neon configuration", () => {
  it("maps Neon's copied AWS parameters into the app's S3 variables", () => {
    const env = storageVariables({
      AWS_ENDPOINT_URL_S3: config.S3_ENDPOINT,
      AWS_REGION: config.S3_REGION,
      AWS_ACCESS_KEY_ID: "nak_live_synthetic",
      AWS_SECRET_ACCESS_KEY: "nsk_live_synthetic",
    });
    expect(evidenceStorageConfig(env)).toMatchObject({
      bucket: "pailangz-evidence",
      options: {
        endpoint: config.S3_ENDPOINT,
        credentials: {
          accessKeyId: "nak_live_synthetic",
          secretAccessKey: "nsk_live_synthetic",
        },
      },
    });
  });

  it.each([
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ])("reports unavailable storage when %s is missing", (key) => {
    expect(() => evidenceStorageConfig({ ...config, [key]: "" })).toThrow(
      expect.objectContaining({ status: 503 }),
    );
  });

  it.each([
    "not-a-url",
    "http://example.invalid",
    "https://user:password@example.invalid",
    "https://example.invalid?token=secret",
  ])("rejects unsafe or malformed endpoints", (endpoint) => {
    expect(() =>
      evidenceStorageConfig({ ...config, S3_ENDPOINT: endpoint }),
    ).toThrow("valid HTTPS endpoint");
  });

  it("supports the AWS default endpoint", () => {
    expect(
      evidenceStorageConfig({ ...config, S3_ENDPOINT: "" }).options.endpoint,
    ).toBeUndefined();
  });

  it("closes the client after a failed storage download", async () => {
    mocks.send.mockRejectedValue(new Error("synthetic provider failure"));
    await expect(getStoredEvidence("opaque-key")).rejects.toThrow(
      "synthetic provider failure",
    );
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});
