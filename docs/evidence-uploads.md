# Private evidence uploads on Vercel

Use Neon Object Storage in the existing `pailangz-db` project, on the same `main` branch as the production database. It supports the S3 API used by this app, including encrypted object uploads, downloads and deletion. Singapore is a supported region. An AWS account is not required.

## 1. Create a private bucket

In Neon, open **pailangz-db → main → Object storage → New bucket**. Name it **pailangz-evidence**, choose **Private**, and click **Create**. If the bucket already exists, confirm its access level is Private.

## 2. Save the storage credentials locally

Click **Connect → Storage** and select **Parameters only**. Reveal the credential and copy its parameters. Use a credential with storage write access, which includes read and delete access.

Paste the four `AWS_*` lines into `.local/neon-transfer/storage.env`, below the prepared bucket name. This is an ignored, private file; do not paste credentials into chat or commit them. These are storage credentials, separate from the Postgres connection string.

The check command maps Neon's names to the app's names:

| Neon parameter          | Vercel variable               |
| ----------------------- | ----------------------------- |
| `AWS_ENDPOINT_URL_S3`   | `S3_ENDPOINT`                 |
| `AWS_REGION`            | `S3_REGION`                   |
| `AWS_ACCESS_KEY_ID`     | `S3_ACCESS_KEY_ID`            |
| `AWS_SECRET_ACCESS_KEY` | `S3_SECRET_ACCESS_KEY`        |
| Your bucket name        | `S3_BUCKET=pailangz-evidence` |

For Singapore the region is `ap-southeast-1`. Copy the endpoint from the **Storage** tab; the Postgres hostname is not a storage endpoint. Preserve the full access key ID (including `nak_live_` if present).

## 3. Check storage and prepare the Vercel variables

From `/Users/Ai/Dev/pailangz`:

```sh
pnpm evidence:check
```

If your terminal still needs the bundled Node/pnpm tools:

```sh
export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
pnpm evidence:check
```

The check reads `storage.env` and the existing production keyring from `vercel.env`. It uploads one encrypted synthetic screenshot, reads/decrypts it, checks that anonymous access is denied, and deletes the test object. It does not connect to or modify the tournament database.

Only after all checks pass does it write `.local/neon-transfer/vercel-storage.env` with the populated storage variables and `EVIDENCE_STORAGE=s3`. Errors do not print credentials or object contents. If cleanup fails, the output identifies the opaque test object to remove.

## 4. Import and deploy

In Vercel, open **pailangz → Settings → Environment Variables → Import .env**. Choose `vercel-storage.env`, select **Production**, save, and replace existing values for the same storage keys if prompted. Keep access/secret keys Sensitive and server-only. Preserve the existing database, authentication and encryption variables.

Deploy the updated source code. If using a Git-connected project, review, commit and push the upload changes first; redeploying an older commit will retain its old 5 MB limit. Updating variables only affects subsequent deployments.

## 5. Use evidence uploads

1. Sign in as authorized staff and open a current stage's match.
2. Submit the actual match result, then open its saved **Result** entry.
3. Select a **PNG, JPEG or WebP up to 4 MB** and click **Upload private evidence**.
4. Confirm **Evidence uploaded**, then use **Download private evidence** to open the original screenshot.
5. Attach evidence before accepting the result; uploads are permitted while the result is **Submitted**. Existing evidence remains downloadable in retained history.

Use a synthetic preview database and bucket for a test result rather than inventing scores in the production tournament. Browser uploads and downloads go through the authenticated app; objects contain AES-GCM ciphertext with opaque keys, so the Neon file browser will not preview them as screenshots. Server-side access requires no browser bucket CORS configuration.

The 4 MiB file cap leaves room for multipart fields below Vercel's 4.5 MB request/response limit. Existing previously uploaded larger evidence is not deleted. File signatures are checked; this does not fully decode or scan image contents.

## Troubleshooting

- **Private storage is not connected:** one of `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` is missing from the active deployment. Check Production variables and redeploy.
- **NoSuchBucket:** create the bucket on `main` and confirm the endpoint belongs to `main`.
- **InvalidAccessKeyId / SignatureDoesNotMatch:** use the complete storage access key ID and matching storage secret, not the Postgres password or API token.
- **AccessDenied:** confirm storage write permission and that the credential is valid for the branch serving the bucket.
- **Screenshot too large:** export/compress it below 4 MB or select a smaller screenshot.

Provider references: [Neon buckets](https://neon.com/docs/storage/buckets), [Neon authentication](https://neon.com/docs/storage/authentication), [Neon S3 client configuration](https://neon.com/docs/storage/get-started), and [Vercel function limits](https://vercel.com/docs/functions/limitations).
