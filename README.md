# PAILANGZ / PAILANGZZ

A working Next.js 16 / TypeScript / Tailwind 4 scaffold with PostgreSQL, Prisma 7, Auth.js (NextAuth), email/password staff login, encrypted registration data, row policies, transactional audit history and configurable competition sizes/rules. Public copy supports Bahasa Melayu (default) and English.

## Local setup (no paid services or Docker required)

Use Node.js 24 LTS and pnpm. From this repository:

```sh
pnpm install
pnpm db:generate
pnpm setup:local
```

The setup creates independent random secrets in the ignored `.env` (mode 0600) and a persistent **synthetic development** PostgreSQL-compatible PGlite database in `.local/postgres`. It does not overwrite an existing `.env`. Keep real member records out of development and preview environments.

Start the database in terminal 1:

```sh
pnpm db:local
```

It binds only to `127.0.0.1:5548`. In terminal 2:

```sh
pnpm db:seed
pnpm staff:provision
pnpm dev
```

Open <http://localhost:3000>. The database and application must both stay running. For production build verification, stop the development web server, run `pnpm build`, then `pnpm start`. The scripts use the supported Webpack compiler because the desktop sandbox blocks a subprocess port used by Turbopack.

PGlite is a local development convenience, with serialized underlying transactions. Production uses native PostgreSQL. Its owner connection exception is allowed only in local development; protected transactions still assume `pailangz_app` and exercise the row policies. Native PostgreSQL uses a separate runtime login and has no owner exception.

## Initial admin and subsequent staff

`pnpm staff:provision` requires an interactive terminal and the separately configured owner/migration connection. Enter an email, display name, `ADMIN` or `MODERATOR`, and a new password with at least 14 characters. Password input is hidden and bcrypt uses cost 12. No default credentials are seeded.

Sign in using the email and password entered during provisioning. No authenticator enrollment or code is required. The user's later request replaces the original mandatory MFA requirement. Migration 008 removes the old authenticator fields, revokes previous sessions and records the authentication policy change while preserving existing staff identities, roles and password hashes.

Staff sign in at `/staff`, or click the homepage's top-left logo five times within five seconds. Public navigation has no staff portal links. The password field has a show/hide button.

Admins create, edit, suspend and remove staff accounts at `/admin/staff`. Active accounts appear first; suspended accounts have a separate filter. Account edits revoke existing sessions, and the database prevents self-removal or removing the last active admin. Operators can also provision accounts through the CLI. To update existing passwords, run `pnpm staff:passwords --neon` and enter a separate password for each active account privately in the terminal. To preview disposable QA cleanup, run `pnpm staff:cleanup --neon`; add `--apply` to remove the displayed suspended QA accounts and their sessions while retaining audit history. Use `--local` for the local database. Follow [the staff account guide](docs/staff-accounts.md) for the complete procedure. Password maintenance is an audited operator procedure; there is no public reset endpoint.

Public registration creates neither staff accounts nor tournament eligibility. Staff and member IDs are independent; tournament codes P01–P64 are not global member IDs. The application rechecks current staff status, session revocation and role on every protected request. Client-supplied roles or Auth.js session updates cannot assign permissions.

## Independent SOLO and TEAM events

Tournament creation offers **SOLO tournament** or **TEAM tournament**. SOLO defaults to 32 players, a six-round league, qualification and knockout. TEAM defaults to eight teams of four players. The team count is configurable from 2 to 256 when creating an event or through **Sizes & updates**. Choose a matching knockout bracket (and explicit byes if needed); series lengths are configurable odd numbers from 1 to 99, with a separate final setting (for example, BO5 knockout rounds and a BO7 final). Each event has its own registration, stages, sizes, rules and publication checklist. SOLO never waits for team rosters or team seeding; TEAM never waits for a SOLO league or qualification round. Existing event formats are fixed; create another event for a different format.

`pnpm db:seed` creates separate empty official SOLO and TEAM drafts with editable capacities. It preserves existing revisions and does not replace entrants or fixtures. The original combined 64-player fixture remains available only with `--legacy-test-fixtures` for regression tests.

Apply migration `202610090025_independent_event_previews` for the landing page's side-by-side SOLO and TEAM tabs. Each tab reads its own tournament configuration, entrants and fixtures. Only the explicitly designated official tournaments receive anonymous schedule previews before publication; draft scores remain hidden. Public team directory links use the selected TEAM event's slug.

For an existing combined official event, first apply migration `202610090024_independent_tournament_formats`, then run `pnpm db:split-tournaments` against local development. This operator command saves an ignored, private backup under `.local/tournament-split/`, renames the original to **PAILANGZ & PAILANGZZ — Solo Tournament**, retains its slug and all SOLO entries/rules/fixtures, and creates **PAILANGZ & PAILANGZZ — Team Tournament** at `pailangz-team`. Existing teams, configured team capacity, bracket size and stages move to the new event; their associated players receive separate TEAM entries. The new TEAM event starts as a private draft with registration disabled. The operation records a configuration revision and audit history and is safe to rerun.

The split refuses published/started events, pending revisions, or existing TEAM fixtures that need a deliberate migration. It does not run during a build or automatically against hosted databases. Production and test require their own separately authorized operator migration; code promotion never transfers local records.

The original individually shared registration URL and approved SOLO-name preview remain valid. Member identities are shared across the community; event participation and team membership are independent.

### Original roster history


Members start unverified and participants ineligible. Mapping is provisional. P64 uses **Smith69** under the later section 17 instruction, overriding the earlier `Smith69.` roster spelling; the reconciliation is audited. The latest supplied registration CSV corrects P35 to **Eagle BoB** and P61 to **PamperSBaby230**. Unicode diacritics, case and meaningful symbols are preserved for display. A NFC-normalized, trimmed, full Unicode case-folded key has a database uniqueness constraint.

Seed provenance has a system actor. The landing page has an explicitly authorized schedule preview for this original event: it shows saved participant codes, approved SOLO in-game names, public team names/codes and prepared pairings while keeping draft results and dates private. The restricted `PublicEventPreview` database view supplies the schedule; migration 011 adds `PublicEventPlayerName`, which exposes only the original event's slug, participant codes and current in-game names. Archived members and events are excluded; other drafts and registration fields remain hidden. Staff can preview every fixture at `/admin/matches` or `/moderator/matches`. Full publication requires the readiness checklist, a non-draft lifecycle, approved eligible members and complete team rosters. No rule is silently confirmed by the seed.

The current local draft was reconciled to the supplied 65-row registration CSV in an audited roster revision. The user excluded **LEEJIN (listing P15)** and included **DarkNightx (listing P65)**, so the tournament still has 64 entrants. Codes retain their CSV row numbers, leaving P15 absent. P65 replaces P15 in all six unplayed pairings; the other pairings, match UUIDs and private member records are preserved. P35 and P61 link to the existing approved Eagle BoB and PamperSBaby230 member records. Applied revision 2 prevents a seed rerun from restoring the earlier player mapping. LEEJIN remains in the member registry, outside this tournament.

## Interactive knockout bracket

TEAM events show their configured bracket in **Bracket**. The original combined 16-team fixture remains available for regression testing. Select a winner to advance it through the quarterfinals, semifinals and final; champion and runner-up update automatically. Changing an earlier winner clears only the later picks on that path. Reset picks starts over. Personal picks are saved in browser-tab session storage and survive reloads and category changes; they never submit competition results.

The same view appears on published tournaments' Brackets pages. When official pairings exist, **Official** shows confirmed staff results and **My picks** offers a separate prediction. Before seeding is confirmed, the practice bracket uses clearly labelled sample teams or seeds. Both categories follow their configured bracket size, byes and configured best-of series lengths. Published SOLO tournaments show approved in-game names alongside participant codes on the landing page and tournament pages. The bracket supports keyboard selection, horizontal scrolling on phones, Bahasa Melayu and English.

## Web member registration

`/register` contains the bilingual Pailangz Member form, shared individually with selected applicants. It is omitted from public navigation and the footer and marked `noindex, nofollow`. New web submissions require **in-game name (IGN), TikTok username (display name), TikTok ID (@handle), and country**. WhatsApp number, Discord name, Discord ID (username), and state/province are optional. The profile examples distinguish display names from handles using the supplied screenshots. Existing member records and CSV imports can retain blank or missing TikTok fields; editing or linking an existing member does not force completion or replace saved contacts.

`POST /api/registration` validates the fields and country selection, limits request size, checks the request origin, and rate limits submissions. Migration 012 adds an insert-only database function for encrypted `WEB_FORM` submissions, conflicts and atomic audit history. Table reads, direct anonymous inserts and member changes remain restricted by the existing staff policies. A request UUID makes retries idempotent; responses reveal no private answers or existing-member conflicts. Submissions enter the moderator registration inbox as pending and follow the existing approval/linking workflow. They create neither staff access nor tournament eligibility.

## Registration import

The user confirmed these form headers:

```text
Timestamp, IGN, Whatsapp Number, Tiktok username, Tiktok ID,
Discord Name, Discord ID, State/Province, Country, status
```

All answers other than IGN are private, including timestamp, social IDs, location and form status. Unknown fields are encrypted and retained privately. `status` is never interpreted as a staff role, registration approval or tournament entry.

Configure the IGN, phone and country column names at `/admin/settings`. The initial mapping uses `IGN`, `Whatsapp Number`, and `Country`. Phone strings preserve their submitted spelling and leading zeros. The default national-number policy is Malaysia (`PHONE_DEFAULT_COUNTRY=MY`); recognized ISO country codes and English or Malay country names select the parser country. Missing or invalid numbers are flagged; the application never invents numbers.

Upload UTF-8 CSV with a unique header row in the inbox/import screen. Optional `response_id` is the source's stable response identifier. If it is absent, a content SHA-256 digest provides repeat-import detection for exactly identical responses. **Edited source responses without stable IDs produce new staging entries**, not silent member overwrites. Row numbers are never treated as durable identities. A future Google adapter should provide a genuine stable response ID.

Use `fixtures/registration-demo.csv` only for demonstration. Its phone marker is deliberately invalid, one row demonstrates an existing IGN conflict, and another demonstrates a missing phone. There are no demo results in the official seed. CSV imports are limited to 2 MB / 1,000 rows, retain provenance, and are processed transactionally.

Imported records enter the registration inbox's default pending-review queue. Search/filter/pagination and counts are available. Approve a clean record directly or select several for one atomic approval. Notes are optional for ordinary approval, rejection or clarification. Conflicts remain in staging; choose the matching existing member by player name in the review form. Linking preserves that member's saved contact information. Approval does not automatically enter a tournament. Confirm eligibility separately in the member registry.

Members have a compact searchable list with one-click phone viewing and an editor for player name, phone and imported registration fields. Sensitive fields remain encrypted, and access and changes are recorded automatically. Ordinary edits, eligibility checks, roster changes and settings do not require a reason. Activity history defaults to changes and shows the staff name, time, affected record and readable summary; access events have a separate filter. See [staff operations](docs/staff-operations.md) for the daily workflow and the decisions that still require an explanation.

## Google Form / Sheets

The native web form is shared directly with selected applicants. Legacy Google responder links may still be stored in admin settings or `GOOGLE_FORM_RESPONDER_URL`, but `/register` no longer depends on them. The supplied `/edit` reference is not a responder URL and is never exposed as a registration destination.

Google Sheets synchronization is **disconnected**. `/api/registration/webhook` is a disabled adapter boundary. With `REGISTRATION_WEBHOOK_SECRET`, it verifies `x-pailangz-timestamp` (Unix milliseconds within five minutes) and `x-pailangz-signature` (hex HMAC-SHA256 of `<timestamp>.<raw-body>`), but still returns 503 because no integration actor or automatic ingestion worker is configured. Merely setting a key does not make imports live. Future ingestion must have its own narrowly scoped trusted actor, replay/idempotency protection and atomic audits.

Restrict Google Form editing and the linked response Sheet to authorized operators. Disable **View results summary** in the form's presentation settings. No access or settings were changed in Google. Do not automatically email or message registrants.

## Rules and progression

The staff readiness screen shows the unresolved dates/deadline, game title, draw policy, series-level scoring, league tiebreakers, qualification series length / carry / pairing / tiebreakers, SOLO knockout pairing, TEAM seeding, special outcomes and evidence/dispute deadlines. Weapon and weapon mode selection remains free.

Staff edit rules with readable choices, arrange tiebreakers with Move up / Move down, and tick Confirmed only for approved rules. A new rule version and an optional note are recorded. The structured settings below describe the internal storage format; staff never need to type it. A typical **staff-chosen** league confirmation might contain:

```json
{"seriesPoints":true,"drawPolicy":"no_draws","tiebreakers":["differential","wins"]}
```

Supported keys: `seriesPoints` (must be true), `drawPolicy` (`no_draws` / `moderated_draw`), `tiebreakers` (`wins`, `differential`, `gameWins` in approved order), `qualificationBestOf` (3 / 5), `qualificationCarry` (boolean), `qualificationPairing` (`manual` / `auto`), `qualificationTiebreakers` (same metrics), `knockoutPairing` (`ranked_cross` / `manual`), `teamSeeding` (`manual`), `byePolicy` (`none` / `rotating_no_points` / `seeded_top`), `specialOutcomes` (`none` / `forfeit`), `evidenceDeadline` and `disputeDeadline` (operator-confirmed text). These options are capabilities, not official tournament decisions.

Each result is a versioned series with individual game winners, submitter/time and optional private screenshot evidence. Ordinary submissions and confirmations have optional notes; corrections, forfeits, rejection and disputes require an explanation. Series lengths accept odd numbers from 1 to 99; BO3 needs two game wins, BO5 three and BO7 four; games cannot continue after the series is won. Individual game ties are unsupported. Draws and forfeits require the selected confirmed policy. Open disputes can be resolved by upholding the current accepted result or voiding the match, with an encrypted resolution reason and atomic audit event. Acceptance is transactional and idempotent; old accepted versions remain immutable. Only the current accepted result of a finalized non-voided match contributes to standings. W/D/L series points are 3/1/0, not per-game points.

Under **Fixtures & results**, select the stage and round, then search opponents or filter match status. The Round options update immediately when the stage changes and reset to that stage’s first round. Only eight editors are loaded per page; the complete round remains available in a collapsed visual preview. **Enter / correct result** has player buttons for each game, automatic series winner calculation and configured best-of validation. Screenshot evidence is optional: choose **Save & confirm** with or without an upload, or save for later review. Knockout confirmations can advance the winner in the same workflow. Retries reuse the saved submission instead of creating duplicate versions. Optional evidence uploads retain their file validation; confirmed rules and server result checks still apply.

Unresolved ties have no numerical rank. Freeze a complete ranking only after every approved, eligible player completes the configured stage match quota; any remaining ties require an explicit reason and a complete player ranking arranged by name. The direct slots select the first league ranks; the playoff pool selects the following ranks. Choose opponents by name or confirm **Auto assign balanced opponents** for `playoffEntrants × qualificationMatchesPerPlayer / 2` matches with equal match counts and no repeated playoff opponents. Automatic assignment uses the frozen league ranking and creates fixtures only when staff select **Auto assign & create fixtures** in stage progression. In the original draft, ranks 1–8 qualify directly, ranks 9–24 play qualification, and 16 qualification series give each player two matches. Its supplied six-round league remains unchanged until an explicit revision.

After current rankings are frozen, explicitly generate the SOLO bracket. The confirmed `ranked_cross` method requires equal direct/playoff slots and a full bracket: direct rank 1 faces the last qualification rank, and so on. Other configurations use `manual` with every qualified entrant in an explicit seed order. SOLO knockout series default to BO5, with independently configurable knockout and final lengths. TEAM requires the configured number of complete four-player rosters and an explicit seed order; no member may occupy two active teams in the category. TEAM knockout defaults to BO3 through semifinal and BO5 in the final; both lengths are independently configurable under **Sizes & updates → Series lengths**. Playoff length is configured in qualification rules. Winner or seeded-bye advancement is an explicit audited action.

Corrections flag affected ranking snapshots and downstream dependencies stale. Block result submissions/starts/advancement until an admin records a resolution. Started matches cannot have opponents replaced. Administrative resolution can retain an opponent with a reason or replace a scheduled opponent; more complex tournament rescheduling/rollback remains an operator decision. No automated downstream rewrite runs behind a moderator's back.

## Configurable tournament sizes and revisions

The landing page includes a SOLO/TEAM event centre with a configuration-based progression chart, round fixture tables, standings and saved knockout brackets. It reads published event data or the original event's anonymous schedule preview. Pending standings, team registrations and unprepared brackets are labelled clearly. Player labels use the exact assigned database codes, including gaps in their numbering; team labels use public names with permanent category-local T01-style codes. Migration 009 allocates these codes automatically and retains them through renames and archiving. The tournament overview and staff **Tournaments & rules → Tournament presentation preview** retain the clickable progression diagram. Public fixture pages and **Fixtures & results → Visual fixture preview** have round buttons, entrant lists and expandable pairings. These views read the existing schedule and support Bahasa Melayu/English, keyboard controls and narrow screens. Unconfirmed qualification formats stay explicitly pending.

Moderators/admins create a draft with a validated configuration, then open **Tournaments & rules → Configure sizes & regenerate** for numeric capacity, round, match-quota, bracket and qualification fields. Select approved members by name separately and generate the league after every configured SOLO slot is filled. The initial new-draft preset is 32 SOLO / eight TEAM; these are editable presets. Every tournament has its own `/participate/<slug>` link and shared SOLO/TEAM player pool, using the configured SOLO capacity. Enable registration in the tournament overview to open signup and team pages before fixture publication. At capacity the form closes; withdrawn entries release places and cannot self-restore. Migration `202610080020_moderator_tournament_setup` enables moderator rules, player confirmation, publishing and ranking actions, adds per-event signup visibility, and retains entrant history for audited withdrawals/replacements. See [staff operations](docs/staff-operations.md) for the workflow and admin-only exceptions.

An even-sized league schedules one match per entrant each round; round count equals the match quota, which must be below the entrant count. Circle-method generation validates every round, exact match quotas and unique opponents. For example, 32 entrants over six rounds generate 16 matches per round and 96 total. Eight TEAM entrants in an eight-slot bracket generate Quarterfinals → Semifinals → Final (4 / 2 / 1 series).

Odd SOLO counts require `rotating_no_points`. This balanced policy supports a full cycle of N rounds, N−1 played matches per entrant and exactly one bye each. Partial odd-count cycles are rejected rather than producing unequal match quotas. Byes have an explicit `BYE` status, produce no score/result version and award no league points. Incomplete power-of-two knockout brackets require `seeded_top`, an explicit full seed order and staff confirmation of the affected stage's bye policy. Highest seeds receive byes. Brackets larger than twice the actual entrant count are rejected because they create empty first-round pairs.

All assigned SOLO participants (including provisional players) and all active teams must fit the new capacities. A decrease never deletes or unassigns entrants. Direct winners plus playoff winners must fit the SOLO bracket; the playoff pool and match quotas must permit non-repeating equal-match fixtures. Pure schedule validation also runs in publication readiness.

Before play, an acknowledged draft revision atomically archives existing stages/fixtures, applies the configuration, creates fresh stages and regenerates league fixtures when the configured capacity is filled. Old stages are available through **Include retained competition history**. Publication and rule confirmations reset explicitly.

After results, started matches or publication, a revision is a pending proposal. Only an admin may apply it, with a reason and the exact acknowledgement `RESTART_AND_RETAIN_HISTORY`, or reject it. The supported resolution restarts all competition stages: previous matches, result versions, scores, evidence, frozen/derived standings and entrant identities remain in read-only archived history; previous results do **not** count in the new revision. Old ranking dependencies receive a recorded resolution and cannot feed new brackets. This is an explicit restart, not a migration of old scores into newly generated fixtures. Reconfirm rules and complete readiness before publishing again. Applied/rejected proposals are immutable, and applied versions move forward even after rejected proposals consume a version number.

Migration 007 adds configuration/revision data, bye status, archival metadata and database guards. The seed detects an applied revision and preserves it instead of restoring the original supplied schedule. Integration tests cover draft regeneration, capacity rejection, controlled restarts, preserved result/evidence/ranking history, odd-count byes and dynamic SOLO/TEAM progression.

## English and brand assets

The public interface supports Bahasa Melayu (default) and English through the BM / EN selector. A non-sensitive locale cookie preserves the choice; dates, navigation, registration instructions, empty/error states and page metadata follow the selected locale. The user confirmed player permission to display the original event's SOLO in-game names on the landing page's roster, fixtures, standings and saved bracket. Names retain their saved spelling and participant codes. Tournament pages and the tournament API continue to use codes. Team names are public and appear alongside permanent T codes and roster counts; individual team memberships and private registration fields stay restricted. Authorized staff retain access to IGNs in their original spelling. Staff labels use English.

Staff content editors offer optional English tournament overviews and announcement titles/bodies. If an English version is absent, the original authored text is shown; no machine translation invents official content.

The reference logo was edited through the built-in ChatGPT ImageGen tool into a transparent PAILANGZ-only wordmark. It is used in public and staff areas. [Brand assets and exact generation prompt](docs/branding.md).

The landing page uses adapted React Bits SpotlightCard and FadeContent for subtle pointer lighting and section reveals. They respect reduced-motion preferences and preserve readable content without JavaScript. [Implementation and upstream attribution](docs/react-bits.md).

## PostgreSQL and deployment

`main` is reserved for **production at https://pailangz.vercel.app**. Develop and validate changes on the persistent `test` branch, targeting a separate Vercel project at **https://pailangz-test.vercel.app**, with its own database and private upload storage. Promote the tested commit to `main` using a fast-forward only merge. The setup, environment variable mapping, private local database copy, migration procedure and release commands are in [the test environment walkthrough](docs/test-environment.md). Git promotion transfers code and migrations; it does not copy test records into production.

Use `pnpm db:test:export` to prepare a private copy of the current local database under `.local/test-transfer/`. The test export re-encrypts private fields with an independent test keyring. `pnpm db:test:import` restores it to a fresh Neon database labelled `preview`; `pnpm evidence:test:check` verifies separate test upload storage. These files, local secrets and live database records remain ignored by Git.

To seed Neon with the **current saved local database**, including approvals and the revised P65 roster, use the snapshot transfer described in [neon-deployment.md](docs/neon-deployment.md). `pnpm db:neon:export` prepares private ignored transfer files; `pnpm db:neon:import` copies them to an empty Neon database and compares every row before committing. `db:seed` creates an empty 32-player draft and does not reproduce subsequent local edits.

For an existing imported Neon database, run `pnpm db:neon:migrate` before deploying app updates. It reads the owner URL from the existing private `.local/neon-transfer/target.env`, verifies the production owner, label and migration checksums, and applies pending schema migrations. It also applies the requested **one-time empty 32-player / eight-team tournament reset**, including when the schema was already updated through Neon SQL Editor. The reset backs up the original unplayed event, clears its fixtures and player assignments, archives its teams, and retains member registrations, applications and staff records. A permanent audit record prevents future runs from resetting newly added players or teams. It uses the saved production encryption settings in `vercel.env`; it does not import, seed, rotate passwords or replace keys. Use `pnpm db:neon:migrate --check` for a read-only status check. See [the deployment guide](docs/neon-deployment.md#updating-the-existing-deployment) for prerequisites and backups. The Vercel function region is `sin1`, matching the Singapore database. Push the updated code and redeploy Production after the upgrade succeeds.

For native local PostgreSQL, use the included Docker Compose file (PostgreSQL 17) or an existing **dedicated** instance. Supply an owner password privately and configure separate owner and runtime URLs. Do not reuse unrelated local databases.

Run `pnpm db:migrate` with `MIGRATION_DATABASE_URL`, then provision the runtime role as the owner using a SQL console:

```sql
-- Set a unique password privately, without shell history or source-control exposure.
ALTER ROLE pailangz_app LOGIN PASSWORD '<private runtime password>';
-- This label must match APP_ENV; preview gets a separate database.
UPDATE "DeploymentEnvironment" SET tier = 'production';
```

The migrations create a non-owner, non-superuser, non-BYPASSRLS role and row policies. Use `DATABASE_URL` for that role. Never give it the owner/migration credentials. Runtime startup verifies the actual database role and database environment label. Private transactions set server-established actor/session context, and PostgreSQL checks the current staff/session against database records. No Supabase Auth context is assumed to flow into a Prisma connection, and this scaffold does not use Supabase privileged keys.

For Vercel + managed PostgreSQL (including Supabase), configure server-only **Secret/Sensitive** variables for database URLs, Auth.js secret, encryption keyring, webhook secret and private storage keys. Never use `NEXT_PUBLIC_*` for these. Production requires `APP_ENV=production`, `DATABASE_ENV=production`, `LOCAL_PGLITE=false`, an HTTPS `NEXTAUTH_URL`, encrypted database connections (`sslmode=require` or `verify-full`) and S3-compatible private evidence storage. Prefer provider CA verification (`verify-full`) where supported. Run migrations/seeds/provisioning as an operator or protected CI step; do not put owner credentials in the normal runtime deployment.

Previews must have their **own** database, environment label `preview`, credentials, keyring and storage, with synthetic members only. The app rejects a preview/development database label mismatch and a non-production environment configured as production. Protect preview URLs using Vercel Deployment Protection. Cloud credentials and deployment protection must be configured and verified by the operator; no cloud deployment is included.

Evidence is restricted to validated PNG/JPEG/WebP signatures, up to 4 MiB (shown as 4 MB), with opaque keys and AES-GCM encryption. This fits Vercel's 4.5 MB request/response limit. Local files are 0600 under an ignored private directory. Set `EVIDENCE_STORAGE=s3`, the `S3_*` variables and a private bucket with public access blocked for production. Follow [the evidence upload setup](docs/evidence-uploads.md) to use Neon Object Storage and run `pnpm evidence:check` before importing credentials into Vercel. Downloads require current staff authorization and are audited. Public evidence publication is not enabled in this scaffold. Signature validation is not malware scanning or full image decoding; production may add a scanner and stricter decoding.

Private APIs explicitly send `Cache-Control: private, no-store`; staff pages are dynamic, with CDN no-store headers. Next.js development pages may normalize Cache-Control to `no-store`, which also forbids shared storage. No private records enter static pages, public data projections, metadata, analytics or session replay. Script CSP uses a per-request nonce. Server mutations validate Origin; Auth.js handles its login/sign-out CSRF flow. Persistent database rate limits cover login, mutations, details/reveals and exports.

Bulk private export is disabled unless `PRIVATE_EXPORT_ENABLED=true`. The admin-only API then requires a login within ten minutes, an explicit reason, a rate limit and a committed audit event, and returns at most 1,000 encrypted-source-derived records as a private JSON response. It is deliberately unavailable in the public or moderator UI. Activity history has an authenticated CSV export with optional notes, a rate limit and an audit event, capped at 1,000 accessible events; moderators receive operational events allowed by row policies.

## Keys, retention and recovery

`DATA_ENCRYPTION_KEYS` is a JSON map of base64 32-byte AES keys; `ACTIVE_ENCRYPTION_KEY` selects new writes. AES-256-GCM includes record/purpose associated data. Keep keys outside the database, with restricted secret access and an independently protected recovery copy. Ciphertexts identify their key version. Rotate by adding a new independent key, switching active writes, then running a reviewed owner re-encryption job which decrypts and re-encrypts each record with the same associated-data context. Retain old keys until all records, evidence and retained backups using them have expired. **An automatic rotation job is not supplied.** Losing the required keys makes records unrecoverable.

Set an operational retention policy before importing real members. Suggested implementation process: retain pending raw submissions only for the approved review period, expire rejected/clarification records according to community policy, remove copied CSV sources after validated ingestion, and delete member private records upon an authorized deletion request while preserving non-sensitive audit references and public competition history as permitted. This scaffold archives public entities but does not schedule irreversible personal-data deletion. Restrict and encrypt database/evidence backups; test restoration with the correct external key versions. Do not rely on field encryption to protect a compromised application authorized to decrypt it.

Database connections and the local PGlite server use UTC. Dates and session expirations are PostgreSQL TIMESTAMPTZ instants; display formatting uses Asia/Kuala_Lumpur. Migration 006 interprets any existing naive timestamp as UTC. An existing deployment with non-UTC legacy data must review that conversion before migration. The local database contains synthetic test data only.

Audit state changes and events commit together. Runtime grants omit audit UPDATE/DELETE, and a database trigger also rejects alteration through an owner connection. A database superuser could disable that trigger or rewrite storage: use separate retained audit storage, monitoring and tested immutable backups for stronger production protection. No tamper-proof or zero-breach claim is made.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
# After building; the runner creates its own temporary database and server:
pnpm test:web
```

The integration runner creates an isolated temporary database and destroys it afterward. By default it uses PGlite. To verify actual multi-connection race behavior on native PostgreSQL, set `TEST_PG_BIN_DIR` to a directory containing `initdb`, `pg_ctl` and `postgres` (run as a non-root user), then run `pnpm test:integration`. It initializes its own temporary instance on an unused port; it never connects to your existing PostgreSQL database.

HTTP smoke tests run against an isolated temporary database and loopback server with independent random secrets. The runner applies migrations, seeds synthetic fixtures, tests password login/CSRF/roles/cache/import/privacy and account management, then tears down its resources. It does not use the working local or production database, and it leaves no QA accounts in them. `TEST_PG_BIN_DIR` optionally selects native PostgreSQL for this runner too.

See [verification.md](docs/verification.md) for completed checks and precise limitations. This is a maintainable scaffold, not a claim of completed production security certification.

## Guided staff interface

Team rosters and SOLO entry use searchable player names with selection counts and team limits. Existing teams have prefilled editors. Rankings and starting orders use numbered lists with Move up / Move down controls; playoff opponents use paired name selectors with duplicate and match-count checks. Rule confirmation is always an explicit choice. New tournament links are created automatically. Tournament and match date controls use Malaysia time on every device. Registration columns use separate heading fields. Activity history shows readable summaries and downloads a spreadsheet rather than exposing internal references or structured data. Internal identifiers and backend formats remain implementation details.

## Player-owned tournament teams

Team registration for PAILANGZ & PAILANGZZ SOLO & TEAM is available at `/tournaments/pailangz-solo-team/teams/new`; the public directory is `/tournaments/pailangz-solo-team/teams`. Each team receives a permanent, readable slug and a public detail page, linked from the landing page.

Players verify their IGN and saved TikTok ID to open an eight-hour, HTTP-only member session. A WhatsApp number is not required for team access. Only a verified, active member with `Participant.eligible = true` in that specific tournament can create a team or apply to one. For any tournament with registration enabled, a matching approved, active member’s participation request automatically grants an eligible slot within that event’s configured capacity. Moderators can also assign or restore entrants directly. Withdrawn entries stay in history and cannot reapply without staff restoration.

The creator becomes the owner and first roster member. Applications stay pending until the owner approves or rejects them on the team page. Approval rechecks the applicant's eligibility, the four-player limit and one-team-per-category rule. Joining a team closes any other pending applications in that category. Rejected applications retain their decision. Owners must stay on the roster; staff may archive a team if needed. Registration, applications and decisions close when the tournament is published, closes or its registration deadline passes. Existing staff-created teams remain moderator-managed.

Apply migrations through `202610080016_team_access_without_phone` before deploying this feature. It adds team ownership and slugs, private member sessions, application records, restricted database functions and a public directory view. An unpublished tournament can display its team pages when staff explicitly enable its registration link; other drafts remain private. Contact details, session tokens and pending applicants are excluded from public pages.

Team registration accepts an optional PNG, JPEG or WebP image up to 4 MB. The form previews it as a circle. The server validates the actual image, crops and resizes it to 64 × 64 pixels, removes metadata and saves only a small WebP avatar with the team in one transaction. Team cards and the team detail page display the circular avatar; teams without an image show initials. Migration `202610080018_team_avatars` adds durable avatar storage in the database, so no additional upload service is needed.

Moderator setup regression checks can also run independently with `node --import tsx tests/moderator-setup-isolated.ts`. This starts a disposable database and never uses working credentials or data.
