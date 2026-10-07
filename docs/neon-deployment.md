# Copy the current local database to Neon

This transfer copies the saved database instead of regenerating the original seed. It preserves member approvals and encrypted registration data, tournament revision 2, participant IDs/codes, fixtures, settings, team codes, staff password hashes, sessions and audit history. The only row change is `DeploymentEnvironment.tier`, from `development` to `production`. Prisma migration history is created on Neon from this checkout; PGlite's `local_migrations` table is not copied.

The prepared files are in `.local/neon-transfer/`, ignored by Git. The directory is mode 0700 and files are mode 0600. The snapshot contains private records and password hashes; `vercel.env` contains encryption keys. Keep them local and do not upload them to GitHub, a public bucket or a Page.

## 1. Use the prepared snapshot

Open `.local/neon-transfer/summary.json` for capture time, table counts and the snapshot checksum. This is a point-in-time copy. Later changes to the local database are not automatically included.

To prepare a newer snapshot, keep `pnpm db:local` running, pause staff changes, and use a new ignored directory:

```sh
NEON_TRANSFER_DIR=.local/neon-transfer-new pnpm db:neon:export
```

Use the same `NEON_TRANSFER_DIR` value for the import. Export refuses to overwrite previously prepared files, checks migration checksums, and captures all tables in a read-only repeatable-read transaction. It reads the local owner connection and encryption keyring from the existing `.env`; it does not change `.env` or write to the source database.

## 2. Create a dedicated empty Neon database

Create a new Neon project/branch and an empty database. A dedicated branch avoids sharing the branch-wide `pailangz_app` role with another deployment. Use the Neon owner role for the import, not the app role.

From **Connect**, turn **Connection pooling off** and copy the direct owner connection string with TLS (`sslmode=require` or `verify-full`). Neon recommends direct connections for schema migrations and operations that use session state: <https://neon.com/docs/connect/connection-pooling>.

Do not create `pailangz_app` with the Neon Console/API. Those roles receive privileged `neon_superuser` membership. The project migrations create the restricted role through SQL: <https://neon.com/docs/manage/roles>.

## 3. Set the target connection privately

Edit `.local/neon-transfer/target.env` locally. Replace only the `NEON_DATABASE_URL` placeholder with the direct Neon owner URL. Keep the generated `NEON_RUNTIME_PASSWORD`. Credentials are read from the file, not command-line arguments.

Do not replace the local `.env` with this file. `NEON_DATABASE_URL` is distinct from the existing local `DATABASE_URL`.

## 4. Import

From the repository root, with Node.js 24 and pnpm available:

```sh
pnpm db:neon:import
```

For a newer snapshot directory:

```sh
NEON_TRANSFER_DIR=.local/neon-transfer-new pnpm db:neon:import
```

The importer:

1. Checks the snapshot checksum, encryption keyring checksum and migration files.
2. Requires a direct TLS Neon owner URL and refuses unrelated tables or existing application data.
3. Runs `prisma migrate deploy`, retaining schema, row policies, grants, views and Prisma migration history.
4. Checks that `pailangz_app` has no privileged attributes or role memberships, and gives it the generated runtime password.
5. Copies all rows in one transaction. User triggers are temporarily disabled inside that transaction; foreign keys are temporarily deferred to preserve cyclic references such as accepted results. All FK references are checked and original trigger/constraint definitions are restored before commit. This uses table-owner privileges, not `session_replication_role` or superuser-only trigger commands.
6. Compares every copied row to the snapshot before committing, with only the production environment label adjusted.
7. Connects as `pailangz_app` to verify its identity and the production label, then writes its runtime `DATABASE_URL` into the private `vercel.env`.

A failure during the data transaction rolls back the copied rows and restores database protections. Successfully applied schema migrations remain. The importer never truncates a populated database; use a fresh destination when a copy is already present. If the copy committed but a later runtime connection or file write failed, preserve the destination and diagnose that final step rather than reseeding it.

## 5. Configure Vercel

After a successful import, open `.local/neon-transfer/vercel.env`. Set the real HTTPS `NEXTAUTH_URL` and private `S3_*` storage values. Import its variables into the Vercel **Production** environment, marking credentials as Secret/Sensitive.

For storage, follow [Private evidence uploads on Vercel](evidence-uploads.md). It uses Neon Object Storage and prepares a separate populated `vercel-storage.env` after checking encrypted uploads and private access.

Use the emitted `DATABASE_URL`, which authenticates as `pailangz_app`. It uses the direct Neon endpoint initially; the app currently supplies a connection startup timezone option. Check startup-option compatibility before changing to a pooled endpoint. Neither `NEON_DATABASE_URL` nor `MIGRATION_DATABASE_URL` belongs in the normal Vercel runtime environment.

Preserve the prepared `DATA_ENCRYPTION_KEYS` and `ACTIVE_ENCRYPTION_KEY`. Replacing them with a fresh key would make existing registrations and encrypted revision/audit notes unreadable. `NEXTAUTH_SECRET` is newly generated, so existing local browser cookies do not authenticate to production. Staff can sign in using their existing email/password; suspended QA accounts remain suspended.

Deploy using Node.js 24, the Next.js framework preset, repository root, automatic pnpm installation and `pnpm build`. **Do not run `pnpm db:seed` as the deployment build command.** The snapshot already contains the current saved tournament.

This local snapshot has no evidence objects. Export intentionally stops if evidence records exist, because their encrypted files must also be transferred to private storage; a database-only copy would leave broken evidence links. Production still requires private S3 storage configuration. Use separate synthetic resources and keys for Vercel previews.

## 6. Verify after deploying

Check `/login`, an administrator's registration inbox/member registry, settings and the public event centre. The original tournament should have 64 assigned participants, six league rounds and 192 matches, with P65 present and P15 absent. Authorized staff should see the current roster and be able to reveal an encrypted registration. Confirm fixture order and approvals against the local app.

The importer tests exercise cyclic result references, archived history, copied private rows and staff hashes, permanent team codes, restored immutable audit triggers, rollback after a foreign-key failure, refusal to overwrite data and snapshot corruption checks. A live Neon import still requires the operator's connection string.

## Updating the existing deployment

The snapshot import above is only for an empty database. Once it has succeeded, upgrade the saved production schema from the repository root:

```sh
pnpm db:neon:migrate
```

This reads the existing private `target.env` owner URL, requires the production database label and checks the completed Prisma migration history against this checkout. It refuses unfinished, altered, unknown or skipped migrations, applies only pending migrations and verifies completion. TLS uses `verify-full`. Credentials and row contents are not printed. Existing records, staff passwords and encryption keys are retained; neither snapshot import nor seeding runs.

For this staff operations update, migration `202610070010_staff_management_performance` adds admin-only account functions and performance indexes and makes row-policy identity checks run once per statement. After the command succeeds, push the code and redeploy Vercel Production. The repository's function region is Singapore (`sin1`), matching the Neon database.

The Vercel environment variables already imported for the database and evidence storage remain usable. Keep `NEXTAUTH_URL=https://pailangz.vercel.app`. Owner credentials remain local; do not add the migration URL to Vercel's runtime variables. Verify member editing, registration approval, staff account management and evidence-backed result confirmation after deploying.
