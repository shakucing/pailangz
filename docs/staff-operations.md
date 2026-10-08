# Daily staff operations

Routine work records the staff member, time and affected record automatically. A note is optional for ordinary edits. The app still checks permissions, competition rules and encrypted data access.

## Members and registration

Every tournament has a participation link at `/participate/<tournament-slug>` and a captain's team registration link at `/tournaments/<tournament-slug>/teams/new`. In **Tournaments & rules → Overview & schedule**, enable **player registration and shareable team pages**, save, and find both destinations in **SOLO & TEAM registration links** at the top of the overview. The summary's **Registration links** shortcut opens this panel from any tab. New tournaments start with this switch off. Enabling it exposes the event's name, description, game, dates, player capacity and team pages while draft fixtures and results remain private. For the landing page's featured event, **Tournament registration** leads to the event card with player and team entry links. Full or closed player entry shows its current status; approved players can still form teams while team registration is open. The original `/participate/pailangz-solo-team` link keeps working.

The form checks the IGN against an approved, active member record and compares the saved **Tiktok ID**, ignoring a leading `@` and letter case. Missing or outdated IDs must be corrected in the member editor. Matching applicants receive an eligible SOLO slot automatically and can create or join a TEAM; owners review team applications. Each tournament has its own player pool, limited by its configured SOLO capacity, including staff assignments. Withdrawn entries no longer consume capacity. Retries do not create duplicate places; simultaneous submissions cannot overfill the event.

Registration accepts entries only when enabled, unpublished, in draft or registration-open status, and before the deadline. A full event shows **Registration closed** without a form and removes team-page application links. Publication locks public team roster changes as well as staff roster edits. Closed, started, completed, archived, disabled or missing events reject signup. A withdrawn applicant must be restored by staff before rejoining.

Moderators can create and configure tournaments, confirm rules and player lists, publish/unpublish, save final rankings, and publish announcements. Readiness and result validations still apply. Staff accounts, integration settings, private exports, stale bracket dependency overrides and controlled restarts remain admin responsibilities.

**Withdraw or replace a player** in tournament setup handles changes before play starts. Choose an active entrant, optionally choose a replacement, and record a reason. A replacement inherits the team place and ownership, if any. To withdraw a team owner without a replacement, archive their team first. Previous entrant identities and fixtures remain in history; unplayed fixtures are rebuilt, confirmed rules are retained, and the player list must be confirmed again. Check match dates and regenerate team brackets after a change. If a withdrawal leaves empty slots, fill them or reduce the configured capacity before generating a league. Use **Assign SOLO entrants** to restore a withdrawn player. Published events must be unpublished first; started matches or existing results require an admin-controlled restart.

Apply migration `202610080020_moderator_tournament_setup` before deploying this workflow. Existing tournament and member records are retained, and only the original event's existing signup link is enabled by the migration. Other events require staff to enable their own link.

**Members** searches player names, codes and the last four phone digits. Use **Country** alongside search and member status to filter the full directory, including records beyond the current page. **All countries** removes the country filter; **Not specified** finds records with no saved country. Imported country names and ISO codes match the same country. **Show phone** reveals the number in one click and records access. **Edit member** opens a dialog with player name, phone and the saved editable registration fields together. Saving returns to the same member row; closing an edited form asks before discarding changes. Save only the fields you changed; contact values stay encrypted and are excluded from audit payloads. Archive is reversible, and published tournament roster restrictions still apply.

**Country** and **Status** use dropdowns. Country uses the registration form's country list, including configured import country columns; new selections are saved as ISO country codes and used to recheck national phone numbers. Status accepts **Active**, **Inactive** or **Not specified** and remains a private registration answer; approval, archiving and tournament eligibility use their existing actions. Both fields allow **Not specified** for incomplete historical records. Unrecognized imported values stay visible and can be kept or replaced, while the server rejects new unsupported choices.

**Registration inbox** opens on records waiting for review. Clean records have a direct **Approve** button; selecting several allows one batch approval. A conflict must be resolved by choosing an existing member. Linking retains that member's current saved contacts. **Review registration** and **Resolve duplicate** open a dialog with private details, past decisions and the decision form together. Approved records use **View details**. Review notes are optional. Approved, rejected and all records are available through filters.

## Team images

**Teams & rosters:** Both **Create a team** and **Edit team roster** support an optional team image. Choose a PNG, JPEG or WebP up to 4 MB to preview it; choosing another file replaces it. **Remove image** restores the initials fallback when the team is saved, and **Keep current image** cancels an unsaved image change. Images and roster details save together. Roster-only changes preserve the current image. Team cards and the public team directory use the same saved avatar.

The roster picker uses the selected tournament's registered, eligible players, labeled with their entrant codes and names. Community membership alone does not qualify a player for selection. Withdrawn entrants, unverified or archived members, and players registered only in another tournament are excluded. Players already on another active team remain unavailable. The same requirements apply when saving any active roster, including staff-created teams without a captain; stale or manually altered submissions are rejected. Teams can still be archived after a roster player loses tournament eligibility.

## Results

**Fixtures & results** opens one stage and round, with eight editors per page. Changing the tournament/stage immediately updates the Round options and selects that stage’s first round. Use opponent search or match status to find a series; the full round's visual preview is collapsed initially. Standings load when requested.

Open **Enter / correct result** and tap the player who won each game. The selected winner is highlighted, the next game appears automatically, and entry stops when a player reaches the required wins (two in BO3, three in BO5). Change a selection to correct a winner, or clear a game and later games to undo entry. Optionally attach screenshot evidence in the same dialog. Save actions remain visible while the body scrolls. **Result history & review** groups result versions, evidence and decisions in one dialog; **Match schedule and actions** opens the scheduling and progression controls. **Save & confirm** submits and confirms in one workflow, uploading a screenshot when one is selected. **Save for review** leaves the result for later confirmation. A knockout winner can also advance after confirmation. If a step fails, retrying reuses the saved result version rather than submitting another copy.

Confirmed scoring rules, a complete valid series of game winners and current bracket dependencies are still required. Screenshots are optional for saving and confirming results. Draws and forfeits use their configured policies and can include games already played. The workflow does not invent results or confirm competition rules for staff.

## Activity and staff accounts

**Activity history** defaults to changes and shows who acted, when, the affected record and a readable summary. Member name edits show the old and new name. Open details only when needed. Contact reads and exports are under the access filter; **All events** includes both. The CSV download includes staff names and does not require a note. Moderators see operational events permitted for their role.

**Staff accounts** shows active people first. Admins can add accounts, edit name/email/role, suspend access or delete a disposable account. These actions are audited automatically; edits revoke existing sessions. The current admin cannot remove their own access, and the last active admin is protected. Deletion requires confirmation and retains historical audit and result references. Existing password updates remain an operator terminal procedure; see [staff accounts](staff-accounts.md).

## Decisions that still need an explanation

- Correcting an accepted result, recording a forfeit, rejecting a submitted result or opening/resolving a dispute.
- Voiding a match or overriding opponents after an earlier result changed.
- Manually ordering tied players in a frozen ranking.
- Applying a controlled restart to a published or started tournament.
- Running an enabled bulk export of private registration data.

Ordinary member/contact edits, approvals, eligibility checks, team rosters, schedules, tournament/rule setup, announcements and settings have optional notes.

## Resetting the original event to 32 players

`node --import tsx scripts/reset-official-tournament.ts` previews the named event reset using the owner connection. Add `--apply` to save a private backup under `.local/tournament-reset`, clear unplayed fixtures and tournament assignments, archive teams and deactivate their memberships, and record the 32-player configuration revision and audit event. Community members, registration records and participation applications remain saved. The reset rejects published, started or historical competition data; it does not generate replacement fixtures. Re-running the seed preserves the reset.

The retained format is 32 SOLO players, six league rounds (16 series per round, 96 total), four direct qualifiers plus four playoff winners from an eight-player pool, and an eight-player SOLO knockout. TEAM has eight teams of four in Quarterfinals → Semifinals → Final. Fill the new roster and confirm rules before generating fixtures.
