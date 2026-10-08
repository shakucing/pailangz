# Tournament setup: staff guide

The page separates setup into four sections. On a laptop, readiness sits beside the selected task. On a phone, it sits above a two-column task selector, with the full checklist collapsed. Edit forms open in dialogs so staff can concentrate on one change. The tournament diagram can be collapsed whenever you need more space.

## What the original screenshot means

| Control or information | Meaning and when to use it |
| --- | --- |
| Change tournament sizes · update 3 | Edit player/team capacity, league rounds and qualification/bracket places. “3” is the current configuration revision, not a third tournament. A fresh schedule retains earlier matches in history. Changes to a published competition or existing results may require an admin-controlled restart. |
| Tournament update 3 · Applied / update 2 · Applied | Open the saved size-change proposal, compare earlier/proposed settings, and read its notes. Applied means the change has already taken effect; no further action is needed. Pending updates require a decision. These are now under Sizes & updates → Update history. |
| Choose players and create league matches | Select approved members to become SOLO entrants and confirm eligibility, then generate the league fixtures. Selecting entrants and creating fixtures are separate actions inside the dialog. Staff-assigned entrants and approved participation requests share the same player limit. |
| Readiness · 1/19 | One of the 19 publication checks is satisfied. A circle means an incomplete check; a tick means complete. The count is for this event and can change with configuration. The checked bye-policy item can mean the configured format needs no byes; it does not mean players, dates or rules are ready. |
| Dates and registration deadline / Game title | Set the start time, registration closing time and game title in Overview & schedule. Times use Malaysia time. |
| Draw rules / Points / League tiebreakers | Confirm how draws score, how league points are awarded, and how equal league scores are ranked. |
| Qualification series length / Starting points / Pairings / Tiebreakers | Confirm playoff best-of length, any carried starting points, who plays whom, and how equal playoff scores are resolved. |
| SOLO knockout opponents and starting order | Confirm seeded/manual knockout pairings and the order of qualifying SOLO entrants. |
| Team lineups and starting order | Confirm team roster and knockout ordering rules. Manage the actual four-player rosters under Team rosters. |
| No-shows, forfeits, withdrawals and disconnections | Confirm how staff handle absent players, conceded matches, withdrawals and disconnected games. |
| Evidence deadline / Dispute deadline | Confirm how long players have to submit proof and challenge a result. These are tournament rules, separate from registration closing. |
| Player list confirmed | Staff have checked and confirmed player names and codes. This is a deliberate confirmation, separate from approving registration. |
| 32 approved and eligible SOLO players | The current event requires exactly 32 eligible entrants with approved, active member records. Membership approval alone does not assign a tournament place. |
| 8 teams with four eligible players each | The current format requires eight complete eligible teams. Creating a team with fewer than four players does not satisfy this check. |
| League schedule matches configured capacity, rounds and match quota | The generated fixtures must match the chosen number of entrants, rounds and matches per player. |
| Explicit bye policies confirmed on affected stages | Confirm what happens when an odd league or an unfilled bracket requires byes. A complete bracket may satisfy this without extra action. |
| Overview & schedule | Edit the event name, descriptions, game, dates, registration availability and lifecycle status. Draft/registration/in-progress/completed status is separate from whether fixtures/results are publicly published. |

The main heading is the event name. The new summary shows its status, public/private publication state, assigned player/team counts and configuration revision. View fixtures & results opens the selected event's match workspace.

## Other page actions

**SOLO & TEAM registration links:** the first overview panel links to player entry and captain team registration. Use **Registration links** in the summary to reach it from any tab. Share the event-specific participation URL after enabling registration. The landing page also shows entry links for its featured enabled event, with the current player registration status. Registration/team pages can be available while fixtures and results remain private. The deadline, capacity and event lifecycle also control whether entries are accepted.

**Confirm player list:** record that names and player codes have been reviewed. Do this again after a roster change that invalidates the confirmation.

**Publish tournament / Unpublish:** make official fixtures and results public, or return them to private staff access. Publishing still requires every readiness check. Opening registration is a separate setting.

**Edit tournament rules:** configure and explicitly confirm the rules for the selected stage. “Rules update” is that stage's rules revision. The confirmed-rule summary shows what staff have acknowledged.

**Manage stage progression:** save final rankings for league stages, create qualification fixtures, or create a confirmed SOLO/TEAM bracket as applicable. Resolve ties using the confirmed rules; these controls do not automatically advance an unfinished competition.

**Withdraw or replace a player:** change an entrant while retaining the historical record. Unplayed draft fixtures may be rebuilt and require schedule/player-list review. Started competition requires an admin-controlled restart.

**Show retained stage/result history:** inspect archived stages from earlier revisions. The link now retains the selected tournament filter.

## Suggested staff workflow

1. Set the game, dates and descriptions in Overview & schedule; enable registration when ready.
2. Approve membership and participation, assign any remaining players, and complete team rosters.
3. Confirm each stage's rules and generate/check its fixtures.
4. Confirm the player list and finish the readiness checklist, then publish.
5. Use Fixtures & results during matches; return to Rules & stages when final rankings or a new bracket need confirmation.

For future refinement, a single “next task” based on the current competition stage could guide staff toward scoring during live play and setup during drafts. The current change keeps the existing competition and permission rules while making each task easier to find.

## Before and after

| Device | Before | After |
| --- | --- | --- |
| Laptop | [Original layout](screenshots/session-2026-10-08/tournament-before-desktop.png) | [Task layout](screenshots/session-2026-10-08/tournament-after-desktop.png) |
| Mobile (375px viewport) | [Original layout](screenshots/session-2026-10-08/tournament-before-mobile.png) | [Task layout](screenshots/session-2026-10-08/tournament-after-mobile.png) |

## Session verification — 8 October 2026

- Production activity filtering excludes 121 development events while retaining 602 visible events at verification time. All 723 underlying audit records remain intact. Real/system events and maintenance involving both real and development accounts remain visible.
- Admin password reset supports other admins and moderators, revokes the target's sessions, and records a credential-free audit event. No real staff password was changed during verification.
- The production database has migrations 021–023. The UI changes remain local pending deployment; nothing was committed or pushed.
- The production build, 165 unit tests across 21 files, and eight focused staff-account integration checks passed. The full integration run was interrupted later by a PGlite transport error: `Received unexpected parseComplete message from backend.`
- Browser checks covered task switching, keyboard tab navigation, readiness links, schedule dialogs, EN/BM toggling, theme cycling, reset-dialog visibility, and mobile layout. Password dialogs were closed without submitting credentials.
