import Image from "next/image";
import Link from "next/link";
import { StaffScoringPractice } from "./staff-scoring-practice";
import styles from "./staff-manual.module.css";

function Screenshot({
  name,
  caption,
  wide = false,
}: {
  name: string;
  caption: string;
  wide?: boolean;
}) {
  const src = `/staff-manual/images/${name}.webp`;
  const heights: Record<string, number> = {
    "12-result-review": 710,
    "13-draw": 716,
    "14-forfeit": 716,
    "16-qualification-ready": 706,
  };
  return (
    <figure className={styles.figure}>
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Enlarge screenshot: ${caption}`}
      >
        <Image
          src={src}
          alt={caption}
          width={wide ? 1440 : 780}
          height={wide ? 1000 : (heights[name] ?? 960)}
          loading="lazy"
        />
      </a>
      <figcaption>{caption} Select the image to enlarge it.</figcaption>
    </figure>
  );
}

function Tutorial({
  topic,
  title,
}: {
  topic: "scoring" | "stages";
  title: string;
}) {
  return (
    <figure className={styles.video}>
      <video
        controls
        preload="none"
        playsInline
        poster={`/staff-manual/videos/${topic}-poster.webp`}
        aria-label={title}
      >
        <source src={`/staff-manual/videos/${topic}.mp4`} type="video/mp4" />
        <track
          kind="captions"
          src={`/staff-manual/videos/${topic}.vtt`}
          srcLang="en"
          label="English"
          default
        />
        Your browser cannot play this video. Follow the written steps below.
      </video>
      <figcaption>
        {title}. Pause whenever you need to follow a step. The written
        instructions below cover the full workflow.
      </figcaption>
    </figure>
  );
}

export function StaffManual({ base }: { base: string }) {
  return (
    <div className={styles.manual}>
      <section className={styles.intro} aria-labelledby="manual-start">
        <p className={styles.eyebrow}>English staff guide</p>
        <h2 id="manual-start">Run a match. Run the tournament.</h2>
        <p>
          Follow the numbered steps, watch the tutorials, or try the scoring
          practice. This guide is for admins and moderators. Screenshots use a
          local training event with example players; your event names,
          capacities and match lengths may differ.
        </p>
        <nav className={styles.links} aria-label="Staff manual topics">
          <a href="#scoring">1. Player scoring</a>
          <a href="#rules-stages">2. Rules & stage progression</a>
          <a href="#scoring-problems">Fix a scoring problem</a>
          <a href="#progression-problems">Fix a progression problem</a>
        </nav>
        <div className={styles.links}>
          <Link href={`${base}/matches`}>Open Fixtures & results</Link>
          <Link href={`${base}/tournaments`}>Open Tournaments & rules</Link>
        </div>
      </section>

      <section
        id="scoring"
        className={styles.chapter}
        aria-labelledby="scoring-title"
      >
        <p className={styles.eyebrow}>Tutorial 1</p>
        <h2 id="scoring-title">Player scoring</h2>
        <p>
          A game is one game inside a best-of series. The match result is the
          outcome of the whole series. League points are awarded for the match.
        </p>
        <Tutorial
          topic="scoring"
          title="How to enter, review and correct results"
        />

        <details open>
          <summary>Step 1. Find the correct match</summary>
          <ol>
            <li>
              Open <strong>Competition → Fixtures & results</strong>.
            </li>
            <li>
              Select the correct tournament/stage and round. Changing the stage
              selects its first round, so check the round again.
            </li>
            <li>
              Search by player name, code or team. Use{" "}
              <strong>Match status</strong> if needed, then select{" "}
              <strong>Show fixtures</strong>. More matches are available through
              the page controls.
            </li>
            <li>
              Check both opponents and the best-of length. Select{" "}
              <strong>Enter / correct result</strong> on that match.
            </li>
          </ol>
          <Screenshot
            name="07-fixtures"
            wide
            caption="Use the stage, round, player search and match status to find the right series."
          />
        </details>

        <details>
          <summary>Step 2. Enter a normal win, in any game order</summary>
          <ol>
            <li>
              Keep{" "}
              <strong>Match result → Played · Pick each game’s winner</strong>.
            </li>
            <li>
              Under <strong>Game 1</strong>, select the player who won. The
              selected player shows <strong>Winner</strong>.
            </li>
            <li>
              Select the winner of each next game, in the order actually played.
              The next game appears automatically.
            </li>
            <li>
              Stop when one player reaches the required wins. Check{" "}
              <strong>Series result</strong> and the winner’s name before
              saving.
            </li>
          </ol>
          <div className={styles.callout}>
            Select game winners; do not enter the overall score as a single
            game. Unplayed games stay blank. An individual game cannot be a
            draw.
          </div>
          <Screenshot
            name="09-score-picked"
            caption="Example BO3: the first player wins Game 1, the second wins Game 2, and the first wins Game 3."
          />
          <div className={styles.tableScroll}>
            <table>
              <caption>
                Every possible completed score for common series lengths, shown
                as A-B
              </caption>
              <thead>
                <tr>
                  <th scope="col">Series</th>
                  <th scope="col">Wins needed</th>
                  <th scope="col">Player A wins</th>
                  <th scope="col">Player B wins</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">BO1</th>
                  <td>1</td>
                  <td>1-0</td>
                  <td>0-1</td>
                </tr>
                <tr>
                  <th scope="row">BO3</th>
                  <td>2</td>
                  <td>2-0, 2-1</td>
                  <td>0-2, 1-2</td>
                </tr>
                <tr>
                  <th scope="row">BO5</th>
                  <td>3</td>
                  <td>3-0, 3-1, 3-2</td>
                  <td>0-3, 1-3, 2-3</td>
                </tr>
                <tr>
                  <th scope="row">BO7</th>
                  <td>4</td>
                  <td>4-0, 4-1, 4-2, 4-3</td>
                  <td>0-4, 1-4, 2-4, 3-4</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            <strong>All other lengths:</strong> the app supports odd best-of
            lengths from 1 to 99. For BO N, the target is (N + 1) ÷ 2. The
            winner reaches that target; the loser can have any total from zero
            to one below the target. Any game order is valid if it stops as soon
            as the target is reached.
          </p>
          <p>
            <strong>All BO3 game sequences:</strong> A-A, A-B-A, B-A-A give A
            the win. B-B, B-A-B, A-B-B give B the win. A-B and B-A are still
            unfinished; A-A-B continues after the series is already won.
          </p>
          <StaffScoringPractice />
        </details>

        <details>
          <summary>Step 3. Save and confirm, or send for review</summary>
          <ol>
            <li>
              Review the series total, the winner and any note. For a correction
              or forfeit, enter a clear reason.
            </li>
            <li>
              Optionally attach <strong>Match screenshot</strong>: PNG, JPEG or
              WebP, up to 4 MB. A screenshot is optional when saving or
              confirming.
            </li>
            <li>
              Select <strong>Save & confirm</strong> when you have checked the
              result. This saves a result version and accepts it.
            </li>
            <li>
              Use <strong>Save for review</strong> if another staff member
              should decide. This still requires a valid completed result, draw
              or forfeit; it does not save unfinished normal wins.
            </li>
            <li>
              In a knockout, leave <strong>Advance the confirmed winner</strong>{" "}
              checked to advance after confirmation. Uncheck it if you intend to
              advance separately.
            </li>
            <li>
              Wait for the success message and check the match status. Accepted
              results show <strong>Finalized</strong>. If an upload or
              confirmation fails, retry the same action to finish the saved
              version.
            </li>
          </ol>
          <Screenshot
            name="10-score-save"
            caption="Check the series summary, add optional evidence, then choose Save & confirm or Save for review."
          />
          <div className={styles.callout}>
            <strong>League points:</strong> win = 3, draw = 1 each, loss = 0. A
            2-0 win and a 2-1 win both earn 3 match points. Game totals can
            still affect confirmed tiebreakers. Only finalized results count in
            standings.
          </div>
        </details>

        <details>
          <summary>Draws, no-shows, forfeits and interrupted games</summary>
          <h3>Record a reviewed draw</h3>
          <ol>
            <li>
              Check that this stage’s saved draw rule is{" "}
              <strong>Draws allowed after review</strong>. The Draw option
              appears only when allowed.
            </li>
            <li>
              Open the match result dialog and select{" "}
              <strong>Match result → Draw</strong>.
            </li>
            <li>
              If games were completed, keep{" "}
              <strong>Record games played before the draw</strong> checked and
              pick those winners. Otherwise uncheck it.
            </li>
            <li>
              Ensure neither player has already reached the series win target.
              Add a note explaining the decision, then save for review or
              confirm after checking the policy.
            </li>
          </ol>
          <p>
            A moderated match draw does not require equal game-win totals, but
            must follow the tournament’s decision. It gives each player 1 league
            point. A drawn knockout has no winner to advance.
          </p>
          <Screenshot
            name="13-draw"
            caption="A draw is a match-level decision. Record only games that were actually completed."
          />
          <h3>Record a forfeit or no-show</h3>
          <ol>
            <li>
              Check that the stage’s <strong>Forfeits</strong> rule is{" "}
              <strong>Allowed with a reason</strong>.
            </li>
            <li>
              Select the option naming the player who <strong>forfeited</strong>
              . If A forfeits, B wins; if B forfeits, A wins.
            </li>
            <li>
              Use <strong>Record games played before the forfeit</strong> only
              if games were completed. Enter the real game winners. A no-show
              may have no games.
            </li>
            <li>
              Enter the reason, check that the displayed winner is the other
              player, then save and confirm or send for review.
            </li>
          </ol>
          <Screenshot
            name="14-forfeit"
            caption="Select the player who forfeited, explain why, and check the winner before saving."
          />
          <p>
            A forfeit awards the opponent a match win (3 league points) and the
            forfeiting player a loss (0 points). The app retains any recorded
            games; it does not invent a full winning game score.
          </p>
          <div className={styles.callout}>
            <strong>
              Disconnection, withdrawal, both players absent or an undecided
              game:
            </strong>{" "}
            apply the agreed tournament policy first. Resume or reschedule if
            appropriate, or record a permitted forfeit/draw. There is no
            separate double-forfeit or tied-game result. Keep the match
            unsettled and ask the organiser when the policy does not decide it.
            A roster withdrawal is a separate player-management action.
          </div>
        </details>

        <details>
          <summary>
            Correct a result, review a submission or resolve a dispute
          </summary>
          <h3>Correct the picked winners</h3>
          <ol>
            <li>
              Open <strong>Enter / correct result</strong> on the same match.
            </li>
            <li>
              Select the correct winner of the affected game. To remove a game
              and everything after it, select{" "}
              <strong>Clear this game & later games</strong>.
            </li>
            <li>
              Check all remaining games. A correction may finish the series
              earlier and remove later games, or reopen it and require another
              game.
            </li>
            <li>
              If correcting an accepted result, enter a reason and save the new
              version. Earlier versions remain in history.
            </li>
            <li>
              If the old result affected qualification or a bracket, have an
              admin resolve any changed opponents before continuing downstream
              matches. Review and save current final rankings again where
              required.
            </li>
          </ol>
          <h3>Review a submitted result</h3>
          <ol>
            <li>
              Open <strong>Result history & review</strong> on the match. Check
              the version, game winners and evidence.
            </li>
            <li>
              For a submitted version, choose <strong>Accept</strong>,{" "}
              <strong>Reject</strong> or <strong>Dispute</strong>, then select{" "}
              <strong>Record result decision</strong>. Rejection and dispute
              need a reason.
            </li>
            <li>
              To challenge the current accepted result, use{" "}
              <strong>Open a dispute</strong> and explain why.
            </li>
            <li>
              Use <strong>Resolve dispute</strong> to record the decision. Check{" "}
              <strong>Keep the accepted result</strong> to uphold it; leaving
              this unchecked cancels the match. Enter a reason, then resolve.
            </li>
          </ol>
          <Screenshot
            name="12-result-review"
            caption="Result history keeps saved versions and provides the review decision and evidence controls."
          />
          <p>
            Do not cancel a match just to change its score. Use a correction
            version. A cancelled/voided match cannot receive a result and may
            prevent stage completion.
          </p>
        </details>

        <details id="scoring-problems">
          <summary>Scoring troubleshooting</summary>
          <ul>
            <li>
              <strong>Save disabled / scoring rules missing:</strong> open this
              stage’s <strong>Edit tournament rules</strong>, choose Match
              points and the draw policy, and <strong>Save rules</strong>.
            </li>
            <li>
              <strong>No normal winner yet:</strong> continue until the required
              wins are reached. For example, BO5 at 2-1 is unfinished.
            </li>
            <li>
              <strong>Draw or forfeit option missing:</strong> the stage must
              have the matching saved rule. Confirm the organiser’s policy
              before changing it.
            </li>
            <li>
              <strong>Wrong player won:</strong> check that you selected the
              winner of each game. For a forfeit, select the person who lost by
              forfeiting.
            </li>
            <li>
              <strong>
                No opponents / retained history / bye / voided match:
              </strong>{" "}
              these cannot accept normal scores. Assign opponents through the
              correct progression action, use the current active stage, or
              handle the bye through match actions.
            </li>
            <li>
              <strong>Review changed opponents:</strong> an admin must resolve
              the stale bracket dependency first. Do not enter scores against
              outdated opponents.
            </li>
            <li>
              <strong>Screenshot error:</strong> check the image format and 4 MB
              limit. Retry to finish the saved result; inspect history before
              creating a different submission.
            </li>
            <li>
              <strong>Result absent from standings:</strong> a saved-for-review
              result is not finalized. Review and accept it, or resolve an open
              dispute.
            </li>
          </ul>
        </details>
      </section>

      <section
        id="rules-stages"
        className={styles.chapter}
        aria-labelledby="stages-title"
      >
        <p className={styles.eyebrow}>Tutorial 2</p>
        <h2 id="stages-title">Set rules and manage stage progression</h2>
        <p>
          SOLO follows League → Qualification (when configured) → Knockout. TEAM
          follows its own knockout bracket. Each tournament has its own
          settings, publication and entrants.
        </p>
        <Tutorial
          topic="stages"
          title="How to configure rules and move to the next stage"
        />

        <details open>
          <summary>Step 1. Set the tournament size, dates and players</summary>
          <ol>
            <li>
              Open <strong>Competition → Tournaments & rules</strong> and choose
              the correct event, or use <strong>Create tournament</strong> for a
              new one.
            </li>
            <li>
              In <strong>Overview & schedule → Edit overview & schedule</strong>
              , set the game, start date, registration deadline and status.
              Dates use Malaysia time. Enable registration when ready.
            </li>
            <li>
              For an existing event, open{" "}
              <strong>Sizes & updates → Change tournament sizes</strong>. Set
              capacities, league rounds/matches per player, direct qualifiers,
              playoff pool/winners and bracket size. Follow the form’s
              validation messages.
            </li>
            <li>
              Under <strong>Series lengths</strong>, set league, knockout and
              final best-of lengths. For example, knockout BO5 with a BO7 final.
              Use odd whole numbers from 1 to 99. Qualification length is set in
              its stage rules.
            </li>
            <li>
              In <strong>Players</strong> or <strong>Players & teams</strong>,
              fill the configured slots with approved, active and eligible
              entrants. Complete every required four-player team roster.
            </li>
            <li>
              For SOLO, open{" "}
              <strong>Choose players and create league matches</strong>.
              Select/confirm the entrants and then generate the league fixtures
              as separate actions. Check the schedule and confirm the player
              list.
            </li>
          </ol>
          <Screenshot
            name="02-sizes"
            caption="The tournament size dialog controls capacity, qualification places, bracket sizes and series lengths. Values shown are examples."
          />
          <div className={styles.callout}>
            Confirm sizes before play. Published or started competitions and
            events with saved results can require an admin-controlled restart.
            Size revisions retain earlier fixtures and results in history; they
            are not another tournament.
          </div>
        </details>

        <details>
          <summary>Step 2. Save rules for each stage</summary>
          <ol>
            <li>
              Open <strong>Rules & stages</strong>. Find the correct stage card
              and select <strong>Edit tournament rules</strong>.
            </li>
            <li>
              Choose <strong>Match points → Win: 3 · Draw: 1 · Loss: 0</strong>{" "}
              and the agreed draw policy. These saved rules are required for
              scoring.
            </li>
            <li>
              Set the stage-specific choices in the table below. Set its forfeit
              policy, screenshot deadline and dispute deadline as well. Confirm
              a bye policy wherever the format needs one.
            </li>
            <li>
              Scroll to the end and select <strong>Save rules</strong>. Saving
              confirms filled choices automatically. Blank choices remain
              undecided; clearing a choice removes its confirmation.
            </li>
            <li>
              Check the stage’s <strong>Confirmed</strong> summary, then repeat
              for every relevant stage. <strong>Rules update</strong> is a
              revision number, not the stage number.
            </li>
          </ol>
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Choices to check</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">SOLO league</th>
                  <td>
                    Match points, draw policy and league tiebreakers in priority
                    order: match wins, game differential, or game wins.
                  </td>
                </tr>
                <tr>
                  <th scope="row">SOLO qualification</th>
                  <td>
                    Playoff match length; start from zero or keep league points;
                    staff-selected or automatically balanced opponents; playoff
                    tiebreakers.
                  </td>
                </tr>
                <tr>
                  <th scope="row">SOLO knockout</th>
                  <td>
                    Pair league and playoff qualifiers by rank, or let staff
                    choose the starting order.
                  </td>
                </tr>
                <tr>
                  <th scope="row">TEAM knockout</th>
                  <td>
                    Staff-selected team starting order. Manage the actual
                    four-player rosters under Team rosters.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Every relevant stage</th>
                  <td>
                    Match points, draw policy, forfeits, evidence/dispute timing
                    and any required bye policy.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <Screenshot
            name="04-rules-qualification"
            caption="Qualification has its own best-of length, starting-points rule and opponent assignment choice."
          />
          <p>
            <strong>Starting points:</strong> “Start again from zero” ranks
            playoff results independently. “Keep league points” carries league
            points into playoff totals. Set this before qualification; do not
            assume it carries automatically.
          </p>
          <Screenshot
            name="05-rules-deadlines"
            caption="Set forfeits and clear timing rules, then save. These deadlines are separate from registration closing."
          />
        </details>

        <details>
          <summary>Step 3. Check readiness and publish</summary>
          <ol>
            <li>
              Review <strong>Ready to publish</strong>. Open an incomplete item
              to reach the relevant task and highlighted field.
            </li>
            <li>
              Complete the game/dates, rules, eligibility, team rosters,
              player-list confirmation and schedule/bye checks shown for this
              event.
            </li>
            <li>
              Use an active tournament status. Draft and Archived cannot be
              publicly published.
            </li>
            <li>
              Select <strong>Publish tournament</strong> in the publication
              panel when every check is complete.
            </li>
          </ol>
          <p>
            Registration, tournament status and publication are separate
            controls. Registration can be open while fixtures/results are
            private. Unpublishing keeps players and history. Draft or Archived
            status unpublishes the event; returning to an active status requires
            publishing again.
          </p>
          <Screenshot
            name="01-overview"
            wide
            caption="The event summary, setup tabs and readiness panel help you finish the required setup."
          />
        </details>

        <details>
          <summary>Step 4. Finish the league and save final rankings</summary>
          <ol>
            <li>
              Enter and confirm all configured league matches in{" "}
              <strong>Fixtures & results</strong>. Each player must have the
              required number of finalized matches.
            </li>
            <li>
              Return to <strong>Tournaments & rules → Rules & stages</strong>.
              On the league card, select{" "}
              <strong>Manage stage progression</strong>.
            </li>
            <li>
              Review <strong>Final player rankings</strong>. Select a player’s
              name to inspect their results. Closing the results returns you to
              your ranking changes.
            </li>
            <li>
              Use the arrows to resolve players who remain tied under the
              confirmed rules. Explain your tie decision. Do not move a player
              above someone with better points or a higher confirmed tiebreak.
            </li>
            <li>
              Select <strong>Save final rankings</strong>. This freezes the
              current ranking for the next stage. Check that the league shows{" "}
              <strong>Completed</strong>.
            </li>
          </ol>
          <Screenshot
            name="06-progression-league"
            caption="Review the complete ranking, resolve only genuine ties, and save final rankings after all required matches are finalized."
          />
        </details>

        <details>
          <summary>Step 5. Create and complete qualification fixtures</summary>
          <ol>
            <li>
              On the qualification card, save the playoff length, starting
              points, opponents and tiebreaker rules first.
            </li>
            <li>
              Check that the league has a current saved final ranking. The
              playoff pool comes from that ranking after the direct qualifiers.
            </li>
            <li>
              Select <strong>Manage stage progression</strong>. With automatic
              pairing, choose <strong>Auto assign & create fixtures</strong>.
              With manual pairing, choose every opponent pair and select{" "}
              <strong>Create qualification fixtures</strong>.
            </li>
            <li>
              For manual pairing, use only playoff entrants, no self-matches or
              repeated pairs, and give everyone the configured number of
              matches. The form checks this. Existing qualification fixtures
              cannot be overwritten.
            </li>
            <li>
              Score and confirm every qualification match. Return to its
              progression dialog, review standings, resolve remaining ties with
              a reason, then select <strong>Save final rankings</strong>.
            </li>
            <li>
              Check that qualification shows <strong>Completed</strong>. The
              configured top playoff finishers join the direct qualifiers in
              SOLO knockout.
            </li>
          </ol>
          <Screenshot
            name="16-qualification-ready"
            caption="Qualification progression uses the frozen league ranking and your saved opponent assignment rule."
          />
          <p>
            Before qualification fixtures are created, the final-ranking area
            may be empty. Create fixtures first; save final rankings after
            qualification play is complete.
          </p>
          <p>
            If the tournament has no playoff places, use the configured direct
            qualification path and proceed to knockout once its prerequisites
            are satisfied.
          </p>
        </details>

        <details>
          <summary>Step 6. Create the SOLO or TEAM bracket</summary>
          <h3>SOLO knockout</h3>
          <ol>
            <li>
              Check that the required league and qualification final rankings
              are current. Resolve any stale rankings or changed opponents
              first.
            </li>
            <li>
              Save the SOLO knockout opponent rule. Then open its{" "}
              <strong>Manage stage progression</strong>.
            </li>
            <li>
              If using a manual start, review and arrange the full
              qualified-player order. If pairing by rank, check the saved rule
              and qualifying rankings.
            </li>
            <li>
              Select <strong>Create confirmed bracket</strong>. Review the
              created first-round opponents in{" "}
              <strong>Fixtures & results</strong>.
            </li>
          </ol>
          <Screenshot
            name="16-knockout-ready"
            caption="With manual SOLO seeding, check every qualified player’s starting order before creating the confirmed bracket."
          />
          <h3>TEAM knockout</h3>
          <ol>
            <li>
              Complete all configured teams with four eligible players each.
              Save the TEAM starting-order rule.
            </li>
            <li>
              Open the TEAM knockout card’s{" "}
              <strong>Manage stage progression</strong>, arrange{" "}
              <strong>Team starting order</strong>, and select{" "}
              <strong>Create confirmed bracket</strong>.
            </li>
            <li>
              Check opponents, round lengths and any seeded byes. TEAM has its
              own bracket and does not wait for SOLO league progression.
            </li>
          </ol>
          <p>
            Use the configured bye policy for an unfilled bracket. Do not record
            a made-up game result for a bye.
          </p>
        </details>

        <details>
          <summary>Step 7. Advance winners and finish the event</summary>
          <ol>
            <li>
              On each knockout match, enter a decisive result and use{" "}
              <strong>Save & confirm</strong> with{" "}
              <strong>Advance the confirmed winner</strong> checked.
            </li>
            <li>
              To advance separately, open{" "}
              <strong>
                Match schedule and actions → Advance confirmed winner
              </strong>{" "}
              after acceptance. For a bye, use{" "}
              <strong>Advance player without an opponent</strong>.
            </li>
            <li>
              Check the next match’s opponents. Repeat through the semifinals
              and final, or through the rounds in your configured bracket.
            </li>
            <li>
              Use the final’s configured best-of length. Confirm its decisive
              result. A draw, an open dispute, missing result or stale
              dependency prevents a completed knockout.
            </li>
            <li>
              When all knockout matches are settled and the final has an
              accepted decisive result, the stage shows{" "}
              <strong>Completed</strong>. Set the event’s{" "}
              <strong>Tournament status</strong> to <strong>Completed</strong>{" "}
              separately in Overview & schedule when the event is finished.
            </li>
          </ol>
          <Screenshot
            name="18-knockout-confirm"
            caption="For a knockout, check Advance the confirmed winner before Save & confirm, or advance later from match actions."
          />
          <div className={styles.callout}>
            <strong>Stage badges:</strong> Current stage is the first unfinished
            stage in that category. Upcoming means an earlier stage remains
            unfinished. League/qualification becomes Completed after valid final
            rankings are saved. A badge does not create fixtures, accept scores
            or advance winners for you.
          </div>
        </details>

        <details id="progression-problems">
          <summary>Progression troubleshooting</summary>
          <ul>
            <li>
              <strong>“Every player must complete … finalized matches”:</strong>{" "}
              confirm the remaining results, check disputes/voided matches and
              verify the configured match quota. Saving a result for review is
              insufficient.
            </li>
            <li>
              <strong>Missing rule confirmation:</strong> open that stage’s rule
              dialog, fill the named choice and save. An undecided rule is not
              confirmed.
            </li>
            <li>
              <strong>Ranking order rejected:</strong> supply every entrant
              exactly once. Arrows can resolve ties but cannot reverse points or
              a confirmed tiebreaker.
            </li>
            <li>
              <strong>No qualification entrants / no bracket:</strong> save a
              current league ranking first; finish and save qualification
              rankings when required. Check the configured direct and playoff
              places.
            </li>
            <li>
              <strong>Qualification pairing rejected:</strong> use distinct
              opponents, no duplicate pairs and exactly the required matches per
              entrant. Or save the automatic balanced-pairing rule before
              generating fixtures.
            </li>
            <li>
              <strong>Earlier result corrected:</strong> final rankings or
              dependent matches may become stale. Review corrected standings,
              save current rankings, and have an admin use{" "}
              <strong>Review changed opponents → Confirm opponents</strong>{" "}
              wherever required.
            </li>
            <li>
              <strong>Cannot advance:</strong> check the result is accepted and
              decisive, the match is not disputed, and no stale dependency
              remains. Review an occupied or started next match with an admin.
            </li>
            <li>
              <strong>Changes locked:</strong> unpublished setup edits and an
              admin-controlled restart are different workflows. Ask an admin to
              assess changes to published/started events or saved results;
              retain the existing history.
            </li>
          </ul>
        </details>
      </section>
      <p className={styles.footnote}>
        Guide reviewed 2 November 2026. Training screens illustrate controls;
        use your event’s confirmed policies and configured sizes. Admins handle
        controlled restarts and stale bracket opponent overrides.
      </p>
      <a href="#manual-start">Back to manual topics ↑</a>
    </div>
  );
}
