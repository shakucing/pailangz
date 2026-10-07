import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { DomainError } from "./domain";
import { encrypt, decrypt } from "./crypto";
import { privateTx, audit, type Actor } from "./db";
function s3() {
  return new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
}
function storagePath(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key))
    throw new DomainError("Invalid evidence key.");
  return path.resolve(process.env.EVIDENCE_LOCAL_DIR ?? ".local/evidence", key);
}
export async function putEvidence(actor: Actor, resultId: string, file: File) {
  if (file.size > 5 * 1024 * 1024 || file.size === 0)
    throw new DomainError("Evidence must be between 1 byte and 5 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  let mime: string;
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    mime = "image/png";
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    mime = "image/jpeg";
  else if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    mime = "image/webp";
  else throw new DomainError("Upload a PNG, JPEG or WebP screenshot.");
  const key = randomUUID(),
    sealed = encrypt(bytes.toString("base64"), `evidence:${key}`);
  // Authorize ownership before touching persistent storage; use opaque names only.
  await privateTx(actor, async (tx) => {
    const result = await tx.resultVersion.findUniqueOrThrow({
      where: { id: resultId },
      include: { match: { include: { round: { include: { stage: true } } } } },
    });
    if (result.status !== "SUBMITTED" || result.match.round.stage.archived)
      throw new DomainError(
        "Evidence uploads require a submitted result in a current stage.",
      );
  });
  if (process.env.EVIDENCE_STORAGE === "s3")
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: sealed,
        ContentType: "application/octet-stream",
      }),
    );
  else {
    if (process.env.VERCEL || process.env.APP_ENV === "production")
      throw new DomainError(
        "Persistent private evidence storage is not connected.",
      );
    await mkdir(path.dirname(storagePath(key)), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(storagePath(key), sealed, { mode: 0o600, flag: "wx" });
  }
  try {
    return await privateTx(actor, async (tx) => {
      const result = await tx.resultVersion.findUniqueOrThrow({
        where: { id: resultId },
        include: {
          match: { include: { round: { include: { stage: true } } } },
        },
      });
      if (result.status !== "SUBMITTED" || result.match.round.stage.archived)
        throw new DomainError(
          "This result changed while uploading; evidence was not attached.",
        );
      const e = await tx.evidence.create({
        data: {
          resultId,
          storageKey: key,
          mime,
          size: file.size,
          uploadedBy: actor.id,
        },
      });
      await audit(
        tx,
        actor,
        "EVIDENCE_UPLOAD",
        "EVIDENCE",
        e.id,
        { mime, size: file.size },
        undefined,
        { relatedIds: [resultId] },
      );
      return { id: e.id };
    });
  } catch (e) {
    if (process.env.EVIDENCE_STORAGE === "s3")
      await s3().send(
        new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      );
    else await unlink(storagePath(key));
    throw e;
  }
}
export async function getEvidence(actor: Actor, id: string) {
  const meta = await privateTx(actor, async (tx) => {
    const e = await tx.evidence.findUniqueOrThrow({ where: { id } });
    await audit(tx, actor, "EVIDENCE_DOWNLOAD", "EVIDENCE", id, {
      changedFields: ["evidence"],
    });
    return e;
  });
  const encrypted =
    process.env.EVIDENCE_STORAGE === "s3"
      ? await (
          await s3().send(
            new GetObjectCommand({
              Bucket: process.env.S3_BUCKET,
              Key: meta.storageKey,
            }),
          )
        ).Body!.transformToString()
      : await readFile(storagePath(meta.storageKey), "utf8");
  return {
    bytes: Buffer.from(
      decrypt(encrypted, `evidence:${meta.storageKey}`),
      "base64",
    ),
    mime: meta.mime,
  };
}
