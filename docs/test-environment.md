# Production and test environment walkthrough

Production is `https://pailangz.vercel.app` and follows `main`. Test is intended to be `https://pailangz-test.vercel.app` and follows the persistent `test` branch. Use two Vercel projects connected to `shakucing/pailangz`, each with its own Neon database and private evidence bucket. The requested test hostname must still be available when the Vercel project is created.

## What is prepared locally

- The `test` branch contains the previously uncommitted application work and the environment preparation. `main` stays at its existing commit.
- `.env` connects to the existing local PGlite server at `127.0.0.1:5548`; both application and database tiers are `development`.
- `.local/neon-transfer/target.env`, `vercel.env`, `vercel-ready.env` and `vercel-storage.env` are the existing production credentials. Preserve them for production.
- `pnpm db:test:export` prepares new files under `.local/test-transfer/`, including a database snapshot, new runtime password, new authentication secret, independent encryption keys and a test storage template. It reads the source in a repeatable-read transaction and preserves source application records.
- `.env`, `.local/`, `.vercel/`, database snapshots, passwords and encryption keys are ignored by Git. Commit application code, Prisma schema/migrations, safe examples, tests and documentation. Database records travel through the private transfer, not a Git commit.

The local encryption keyring matched the saved production keyring. Therefore the test exporter decrypts and re-encrypts every supported private database field into the exported copy using a fresh `test_v1` key. It preserves plaintext, record IDs, staff password hashes, relationships, tournament state and audit history. It does not change the local or production keyrings. Existing session records are copied, but test uses a new authentication secret and a separate hostname.

An existing local checksum mismatch for migration `202610080020_moderator_tournament_setup` was investigated before export. A disposable database built from all committed migrations matched local columns, functions, views, constraints, policies, triggers, indexes and app grants. A complete private source backup was saved under `.local/test-schema-review/` before reconciling only that local migration-history checksum. Application rows and schema were preserved. Production was not connected or modified.

## 1. Publish the test branch when ready

The branch is committed locally. To make it available for Vercel import:

```sh
git switch test
git push -u origin test
```

This push can also trigger a preview deployment in the existing production project under Vercel's default Git integration. Before pushing, set the production project's branch filter described in step 4. Keep `main` unchanged until the release is approved.

## 2. Create independent test database resources

Create a **new Neon project**, preferably in Singapore, with an empty database. A separate project avoids accidentally sharing branch-wide runtime roles or cloning production records and credentials. The initial data source is the current local snapshot. Do not create a data-bearing branch from production for this import; the importer requires an empty destination.

In Neon **Connect**, disable connection pooling and copy the direct **owner** PostgreSQL URL with TLS. Save it privately into:

```text
.local/test-transfer/target.env
```

Replace only `NEON_DATABASE_URL`. Keep the generated `NEON_RUNTIME_PASSWORD`. Do not change the local `.env` or production `.local/neon-transfer/target.env`.

With the local database server running, the export command is:

```sh
pnpm db:test:export
```

The prepared snapshot is a point-in-time copy. Export refuses to overwrite it. If a newer copy is required, use a new private directory and keep the same directory and tier for subsequent commands:

```sh
NEON_DEPLOYMENT_TIER=preview NEON_TRANSFER_DIR=.local/test-transfer-next pnpm db:neon:export
NEON_DEPLOYMENT_TIER=preview NEON_TRANSFER_DIR=.local/test-transfer-next pnpm db:neon:import
```

For the initial prepared directory, run:

```sh
pnpm db:test:import
```

The importer requires an empty destination, applies committed migrations, provisions the restricted SQL-created `pailangz_app` login, copies and compares all rows in one transaction, sets `DeploymentEnvironment.tier=preview`, and checks the runtime role. It writes the test runtime URL into `.local/test-transfer/vercel.env`. Owner credentials stay local. Do not run `db:seed` afterward: it cannot reproduce the current saved local state.

The snapshot format excludes PGlite's local migration bookkeeping; Neon receives normal Prisma migration history. The exporter stops if evidence records exist because evidence objects require a separate file transfer. At preparation, the current local database had zero evidence records; team avatars are stored in the database and are included automatically.

## 3. Create separate test upload storage

Create a private bucket named `pailangz-test-evidence` on the **test Neon project/branch**. Save its storage parameters into the prepared:

```text
.local/test-transfer/storage.env
```

Use the test bucket's endpoint, region, access key and secret. Do not copy production's storage file. Check the test service:

```sh
pnpm evidence:test:check
```

This uploads and decrypts an encrypted synthetic screenshot, verifies anonymous downloads are denied, deletes its temporary object, and writes `.local/test-transfer/vercel-storage.env`. See [the evidence storage guide](evidence-uploads.md) for the parameter mapping, using the test project and test bucket throughout.

## 4. Configure the two Vercel projects

Vercel can track a different production branch for each project. In **Settings → Environments → Production → Branch Tracking**, use:

| Setting           | Existing `pailangz` project | New `pailangz-test` project                         |
| ----------------- | --------------------------- | --------------------------------------------------- |
| Repository        | `shakucing/pailangz`        | `shakucing/pailangz`                                |
| Production branch | `main`                      | `test`                                              |
| Stable hostname   | `pailangz.vercel.app`       | `pailangz-test.vercel.app`, subject to availability |
| Framework / root  | Next.js / repository root   | Next.js / repository root                           |
| Node.js           | 24.x                        | 24.x                                                |
| Build             | `pnpm build`                | `pnpm build`                                        |
| Region            | Existing Singapore `sin1`   | Singapore `sin1` from `vercel.json`                 |

For `pailangz-test`, choose **Add New → Project**, import the same repository and name the project `pailangz-test`. Install with pnpm. Enter the prepared test variables before its first deployment. New Vercel projects perform an initial production deployment; ensure its source is the `test` commit. If import initially selects `main`, configure Branch Tracking and create a deployment explicitly from `test` before accepting the test site as ready.

Vercel calls each project's stable deployment **Production**. This is a Vercel deployment target, not the application's data tier. The test project intentionally uses `APP_ENV=preview` and a database labelled `preview` even while its `VERCEL_ENV` is `production`. Keep `NODE_ENV` at the framework's normal production-build setting; do not set `NODE_ENV=test` for staging.

By default, both Git-connected projects may also create previews for other branches. For this initial two-environment setup, use each project's **Settings → Build and Deployment → Ignored Build Step → Custom** to limit automatic builds.

On the existing production project:

```sh
if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 1; else exit 0; fi
```

On the test project:

```sh
if [ "$VERCEL_GIT_COMMIT_REF" = "test" ]; then exit 1; else exit 0; fi
```

For this Vercel setting, exit `1` means build and exit `0` means skip. Enable **Automatically Expose System Environment Variables** so `VERCEL_GIT_COMMIT_REF` is available. These filters are project settings: do not hardcode either one into the shared `vercel.json`, which must work after promotion to both branches. Keep automatic production-domain assignment enabled if a successful `main` deployment should go live automatically.

These filters suppress Git-triggered builds; manual redeployments and explicit deployments still need the correct project and branch. Use deployment protection appropriate to your Vercel plan for test. If copied local records contain real member information, limit test access accordingly. Do not connect production Google Forms, webhooks or external integrations to test; review copied integration settings before enabling those flows.

## 5. Import the correct environment variables

In **the `pailangz-test` project**, import `.local/test-transfer/vercel.env` and then `.local/test-transfer/vercel-storage.env` into its Vercel **Production** scope. Mark credentials Sensitive/server-only. Changing environment variables takes effect on a new deployment.

| Variable or resource                           | Local                              | Test                                | Production                                 |
| ---------------------------------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------ |
| `APP_ENV`                                      | `development`                      | `preview`                           | `production`                               |
| `DATABASE_ENV`                                 | `development`                      | `preview`                           | `production`                               |
| Actual database `DeploymentEnvironment.tier`   | `development`                      | `preview`                           | `production`                               |
| `LOCAL_PGLITE`                                 | `true`                             | `false`                             | `false`                                    |
| `DATABASE_URL`                                 | Loopback local owner (PGlite only) | Test Neon `pailangz_app`, TLS       | Existing production `pailangz_app`, TLS    |
| `NEXTAUTH_URL`                                 | `http://localhost:3000`            | `https://pailangz-test.vercel.app`  | `https://pailangz.vercel.app`              |
| `NEXTAUTH_SECRET`                              | Existing local secret              | Newly generated test secret         | Preserve production secret                 |
| `DATA_ENCRYPTION_KEYS` / active key            | Existing local keyring             | New test keyring / `test_v1`        | Preserve production keyring / active key   |
| `EVIDENCE_STORAGE`                             | `local`                            | `s3`                                | `s3`                                       |
| `S3_*`                                         | Not needed                         | Test bucket and storage credentials | Existing production bucket and credentials |
| `PRIVATE_EXPORT_ENABLED`                       | `false`                            | `false`                             | Preserve intended production setting       |
| `MIGRATION_DATABASE_URL` / `NEON_DATABASE_URL` | Local/operator tools               | Operator only                       | Operator only                              |

Do not import the existing `.local/neon-transfer/vercel-ready.env` into the test project: it contains production credentials. Keep `MIGRATION_DATABASE_URL`, `NEON_DATABASE_URL` and owner passwords out of Vercel's normal application runtime. The application's startup and runtime checks reject non-production access to production-labelled data, incorrect actual tiers, owner roles, local PGlite on Vercel, and hosted test without HTTPS, TLS or S3 evidence storage.

Local files stay for local development. Do not rename `.env` to `.env.test` to select the hosted test environment: Next.js environment-file selection follows `NODE_ENV`, while this application's deployment tier follows `APP_ENV` and its database label.

## 6. Validate and promote an exact tested commit

Before accepting the test deployment, confirm its Vercel Git SHA matches the intended `test` commit. Check login, admin/moderator permissions, registration, member editing, team management, tournament configuration and a synthetic result with an evidence upload/download. Compare copied record counts against `.local/test-transfer/summary.json`; confirm encrypted details remain readable. Confirm the actual database tier is `preview` and the app uses `pailangz_app` without owner privileges.

Run local checks against isolated data:

```sh
pnpm test
pnpm build
pnpm typecheck
pnpm test:integration
pnpm test:web
```

Keep environment-specific values in Vercel and private configuration, so `main` and `test` can use identical code. Implement features on short-lived branches based on `test`, or directly on `test` for a single-maintainer workflow. After publishing changes to `test`, validate the resulting deployment. Keep both long-lived branches; do not delete `test` after release.

Fast-forward only promotion is recommended. It lets `main` point at the exact tested commit and refuses promotion if branch histories have diverged. Record the tested SHA from Vercel. After applying any approved production schema migrations, promote that SHA:

```sh
git fetch origin
git switch main
git merge --ff-only origin/main
git merge --ff-only <tested-commit-sha>
git push origin main
git switch test
```

Replace the placeholder with the full tested SHA. With the production project's Git integration, branch tracking and automatic domain assignment configured, the push to `main` triggers a new build using production environment variables and updates production only after successful deployment. It rebuilds the tested source for production; it does not reuse the test project's deployment artifact.

Fast-forward only is a release rule; auto-deploy happens because Vercel tracks `main`, regardless of merge method. Avoid squashing or rebasing `test` into `main` if preserving the tested SHA matters. GitHub's normal PR merge options either create a merge commit or rewrite commits. Use CLI promotion, or a narrowly authorized release workflow, for exact SHA promotion. Configure branch rules to prohibit force pushes/deletion and restrict production writes to the release operator; requiring a normal PR merge is a different release policy. A linear-history rule alone does not enforce exact SHA promotion.

If a production hotfix advances `main`, bring it into `test`, resolve conflicts and test the new resulting commit before releasing. Do not force-reset either shared branch to make `--ff-only` succeed. Freeze changes on `test` while validating a release, or promote the recorded SHA rather than its moving branch tip.

## Database migrations and rollback

Git promotion transfers code, schema and migration files. **It never transfers test database records or evidence objects into production.** Production keeps its own registrations, players, teams and results.

For the initial workflow, apply schema-only migrations deliberately with the selected environment's private owner URL using `pnpm db:migrate` (`prisma migrate deploy`). Supply `MIGRATION_DATABASE_URL` through an operator process or secret runner, rather than pasting its value into shell history. Review pending migration SQL and take a recoverable production backup first. Apply compatible additive changes before pushing the tested SHA to `main`; destructive changes need a separate staged migration procedure.

Do not run `db:seed`, snapshot import, `prisma migrate reset`, or `prisma db push` in Vercel's build. The existing `pnpm db:neon:migrate` command includes a legacy one-time empty tournament reset. It is not a generic schema-only deployment command and should not be wired into automatic builds. Its `--check` mode is read-only, but routine schema releases should use the explicit schema-only process above.

A future protected CI job can migrate the matching database before triggering its Vercel deployment. Keep owner secrets in separate GitHub environments and coordinate migrations with deployment; adding a migration job alongside independent Vercel auto-builds would introduce a race. The current setup uses automatic code deployment and deliberate migration operations.

Rolling back a Vercel deployment changes application code, not the database. Keep schema changes compatible with the previous release until validation is complete, retain database backups, and test recovery with the correct external encryption keys. Test data is disposable; production data is never replaced from test during promotion.

## Local verification on 9 October 2026

The optimized production build and TypeScript check pass. All 310 unit tests across 32 files, 105 integration checks on native PostgreSQL, 38 isolated HTTP workflows, and 47 desktop/mobile readiness dialog checks pass. Browser checks also cover independent tournament formats, BO7 final scoring, rich announcements, and landing highlight selection. The actual exported database previously restored into a disposable migrated database, matched every exported row, and retained the original contents of all 344 encrypted fields with independent test keys. Prepared private transfer files have mode 0600.

PGlite still produces protocol/backend failures in the full integration suite. The release run passed using PostgreSQL 17.10 with `TEST_PG_BIN_DIR` pointing to its temporary, ignored local `bin` directory. The integration checks run before deliberately revoking the moderator's session; HTTP smoke checks now match the current staff portal labels and the requirement to select landing highlights explicitly.

Both the hosted test and production databases have schema migrations 024–028. Private backups were saved beneath each environment's existing transfer directory before applying schema-only migrations, and every original application row and field was compared afterward. No local or test records were copied into production. Database cleanup and splitting a legacy combined tournament remain separate operator actions; committing and pushing Git does not transfer local database changes.

## Provider references

- [Vercel production branch tracking](https://vercel.com/docs/git#production-branch)
- [Vercel deployment environments and automatic promotion](https://vercel.com/docs/deployments/environments)
- [Vercel environment variable scopes](https://vercel.com/docs/environment-variables)
- [Vercel ignored build step](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel)
- [GitHub merge methods](https://docs.github.com/en/pull-requests/reference/pull-request-merges)
- [Neon direct connections and pooling](https://neon.com/docs/connect/connection-pooling)
- [Neon roles](https://neon.com/docs/manage/roles)
