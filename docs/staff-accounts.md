# Staff login and account maintenance

Staff sign in at `https://pailangz.vercel.app/staff`. On the homepage, click the top-left PAILANGZ logo five times within five seconds to open that screen. The public header and footer have no staff portal links. On other pages, the header logo still opens the homepage. The old `/login` URL redirects to `/staff`.

The password eye button shows or hides what you typed. Staff authentication still uses email and password only. This change adds no public password-reset route.

## Manage accounts in the portal

After migration `202610070010_staff_management_performance` and the updated app are deployed, an admin can open **Staff accounts → Add staff account**, enter a name, email, role and password, then create the account. Moderator is the default role. A password must contain at least 14 characters and fit within 72 UTF-8 bytes. The admin enters and confirms the password privately; it is hashed at bcrypt cost 12 and never included in audit history or returned to the browser.

The list initially shows active accounts. Search by name/email, or switch to **Suspended accounts** or **All accounts** to find old test accounts. It shows 20 accounts per page. Expand **Edit account** to change name, email, role or suspension. **Delete account** opens a confirmation. Edits revoke existing sessions; deleting an account removes its sessions while preserving past activity and tournament records. No written reason is required for these account actions: the actor, target, time and changed fields are logged automatically in the same transaction.

Moderators cannot manage staff accounts. The API and database independently enforce the current admin session. The app refuses edits/deletion of the signed-in admin's own account, and retains at least one active admin. The first admin still needs the owner provisioning command; subsequent admins and moderators can be created in the portal.

For your existing Neon database, run `pnpm db:neon:migrate`, then deploy the reviewed source. The command reads the saved private owner connection in `.local/neon-transfer/target.env`, verifies existing migration history and applies only pending migrations. It does not repeat the snapshot import or seed. Keep the owner connection out of the application's Vercel runtime environment. Migration 010 adds restricted account functions and optimizes database permission checks; it does not create, edit or delete existing accounts. The repository's `vercel.json` runs functions in Singapore, alongside the current Singapore database.

## Why the copied passwords did not appear to work

The Neon transfer preserves `StaffUser.passwordHash` exactly. It generates a separate database runtime password, which does not change staff passwords. The diagnosis on 7 October 2026 confirmed matching hashes for all 22 imported staff accounts, including the three active real staff accounts.

The production login failed while writing its audit event. Prisma's `create()` requests the inserted private audit row back with `RETURNING`, but the restricted runtime role cannot read security events before a staff session is established. The fixed login, denied-login and logout audit writes use `createMany()` to insert without returning private rows. Database read restrictions remain in place.

Deploy this fix before retrying the existing password. Five attempts within five minutes temporarily throttle an email; wait five minutes after repeated failed attempts. A password update also clears that account's login throttle.

## Update passwords for active staff

From `/Users/Ai/Dev/pailangz`, run:

```sh
pnpm staff:check --neon
pnpm staff:passwords --neon
```

The first command lists the active accounts and the number of suspended QA accounts. The second prompts separately for each active staff member:

1. Enter a new password of at least 14 characters and no more than 72 UTF-8 bytes. Input is hidden.
2. Repeat it. Press Enter at the first prompt to skip an account.
3. After all prompts, type **UPDATE** to apply the selected changes.

All selected passwords change in one transaction. Old sessions are revoked, session versions advance and the selected email login throttles are cleared. The command records an audit event without any password or hash in its contents. If an account changes during the prompts, the entire operation rolls back.

The command uses the saved Neon owner connection from `.local/neon-transfer/target.env`. It checks the connection is the table owner and that the database is labelled production. It does not modify `.env`, the local database, members, results or tournament configuration. Passwords are never accepted as command-line arguments and are not written to files.

To update local staff passwords too, run the same commands with **--local** instead of **--neon**. Local and Neon copies do not synchronize after the initial transfer.

## Remove the unwanted QA staff

Preview the accounts first:

```sh
pnpm staff:cleanup --neon
```

Then remove the displayed QA accounts:

```sh
pnpm staff:cleanup --neon --apply
```

The command only accepts accounts that are **suspended**, have names starting **Disposable synthetic QA** or **Disposable browser QA**, and use **@synthetic.invalid** addresses. The initial import contains 19 such accounts. It deletes their sessions before deleting their staff records, and retains all audit and tournament history. It refuses to remove active accounts or real staff; the administrator remains.

You can also run the cleanup with **--local --apply** to remove the old test accounts locally. Cleanup does not prevent future development tests from creating their own disposable accounts.

## Deploy the interface and login fix

Review, commit and push the changed source files to the Git-connected Vercel project. A new production deployment includes `/staff`, the logo shortcut, the eye button and the corrected authentication audit writes. Password updates and QA cleanup change Neon immediately and require no redeploy.
