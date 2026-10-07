import { randomUUID } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { encrypt, decrypt } from "../src/lib/crypto";
import { DomainError } from "../src/lib/domain";
import {
  evidenceStorageConfig,
  putStoredEvidence,
  getStoredEvidence,
  deleteStoredEvidence,
} from "../src/lib/evidence-storage";

export function storageVariables(values: Record<string, string>) {
  return {
    EVIDENCE_STORAGE: "s3",
    S3_ENDPOINT: values.S3_ENDPOINT || values.AWS_ENDPOINT_URL_S3 || "",
    S3_REGION: values.S3_REGION || values.AWS_REGION || "",
    S3_BUCKET: values.S3_BUCKET || "pailangz-evidence",
    S3_ACCESS_KEY_ID: values.S3_ACCESS_KEY_ID || values.AWS_ACCESS_KEY_ID || "",
    S3_SECRET_ACCESS_KEY:
      values.S3_SECRET_ACCESS_KEY || values.AWS_SECRET_ACCESS_KEY || "",
  };
}

let phase = "reading the local storage configuration";
async function main() {
  const directory = path.resolve(
    process.env.NEON_TRANSFER_DIR ?? ".local/neon-transfer",
  );
  const filename = path.join(directory, "storage.env");
  const env = storageVariables(parse(await readFile(filename)));
  const required = [
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ] as const;
  const missing = required.filter((name) => !env[name].trim());
  if (missing.length)
    throw new DomainError(
      `Fill ${missing.join(", ")} in ${filename}, or paste Neon's AWS_* parameters into that file.`,
    );
  const { bucket, options } = evidenceStorageConfig(env);
  // Reuse the deployed keyring; do not replace the local development .env.
  const production = parse(await readFile(path.join(directory, "vercel.env")));
  process.env.DATA_ENCRYPTION_KEYS = production.DATA_ENCRYPTION_KEYS;
  process.env.ACTIVE_ENCRYPTION_KEY = production.ACTIVE_ENCRYPTION_KEY;
  const key = randomUUID();
  const screenshot =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=";
  const sealed = encrypt(screenshot, `evidence:${key}`);
  let attempted = false;
  try {
    phase = "uploading an encrypted test screenshot";
    attempted = true;
    await putStoredEvidence(key, sealed, env);
    phase = "reading and decrypting the test screenshot";
    const stored = await getStoredEvidence(key, env);
    if (stored !== sealed || decrypt(stored, `evidence:${key}`) !== screenshot)
      throw new DomainError(
        "The stored test screenshot did not match its original bytes.",
      );
    phase = "checking that anonymous downloads are blocked";
    const endpoint =
      options.endpoint ?? `https://s3.${options.region}.amazonaws.com`;
    const url = new URL(
      `${encodeURIComponent(bucket)}/${key}`,
      `${endpoint.replace(/\/$/, "")}/`,
    );
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (![401, 403, 404].includes(response.status))
      throw new DomainError(
        "Could not confirm private access. Set the bucket access level to Private and retry.",
      );
  } finally {
    if (attempted) {
      try {
        await deleteStoredEvidence(key, env);
      } catch {
        throw new DomainError(
          `The storage check could not remove its test object. Remove object ${key} from the bucket, confirm delete permission and retry.`,
        );
      }
    }
  }
  phase = "writing the private Vercel import file";
  const output = path.join(directory, "vercel-storage.env");
  const text =
    Object.entries(env)
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join("\n") + "\n";
  await writeFile(output, text, { mode: 0o600 });
  await chmod(output, 0o600);
  console.log(
    "Verified encrypted upload/download, blocked anonymous access and test-object cleanup.",
  );
  console.log(`Vercel storage variables: ${output}`);
  console.log(
    "Import into Production, then redeploy the updated app. No tournament records were changed.",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    // SDK messages may contain request URLs. Only print a safe error name/status.
    const details = error as {
      name?: string;
      code?: string;
      $metadata?: { httpStatusCode?: number };
    };
    const code = String(details.code ?? details.name ?? "ERROR").replace(
      /[^a-zA-Z0-9_]/g,
      "",
    );
    const status = details.$metadata?.httpStatusCode;
    console.error(
      error instanceof DomainError
        ? error.message
        : `Evidence storage check failed while ${phase} (${code}${status ? `, HTTP ${status}` : ""}). Check the bucket, endpoint and read/write credentials.`,
    );
    console.error("No credentials or screenshot contents were logged.");
    process.exitCode = 1;
  });
}
