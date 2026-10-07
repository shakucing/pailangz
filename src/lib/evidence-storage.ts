import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { DomainError } from "./domain";

type Environment = Record<string, string | undefined>;

export function evidenceStorageConfig(env: Environment = process.env) {
  const region = env.S3_REGION?.trim();
  const bucket = env.S3_BUCKET?.trim();
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  const endpoint = env.S3_ENDPOINT?.trim() || undefined;
  if (!region || !bucket || !accessKeyId || !secretAccessKey)
    throw new DomainError(
      "Private evidence storage is not connected. Please contact an administrator.",
      503,
    );
  if (endpoint) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new DomainError(
        "Private evidence storage needs a valid HTTPS endpoint.",
        503,
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new DomainError(
        "Private evidence storage needs a valid HTTPS endpoint.",
        503,
      );
  }
  return {
    bucket,
    options: {
      region,
      endpoint,
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED" as const,
      credentials: { accessKeyId, secretAccessKey },
    },
  };
}

async function withStorage<T>(
  env: Environment | undefined,
  work: (client: S3Client, bucket: string) => Promise<T>,
) {
  const { options, bucket } = evidenceStorageConfig(env);
  const client = new S3Client(options);
  try {
    return await work(client, bucket);
  } finally {
    client.destroy();
  }
}

export function putStoredEvidence(
  key: string,
  sealed: string,
  env?: Environment,
) {
  return withStorage(env, (client, bucket) =>
    client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: sealed,
        ContentType: "application/octet-stream",
      }),
    ),
  );
}

export function getStoredEvidence(key: string, env?: Environment) {
  return withStorage(env, async (client, bucket) => {
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!object.Body)
      throw new DomainError(
        "The stored screenshot could not be downloaded. Please try again.",
        502,
      );
    return object.Body.transformToString();
  });
}

export function deleteStoredEvidence(key: string, env?: Environment) {
  return withStorage(env, (client, bucket) =>
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
  );
}
