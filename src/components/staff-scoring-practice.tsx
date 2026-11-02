"use client";

import { useId, useState } from "react";
import { isValidBestOf } from "@/lib/best-of";
import {
  readGameWinners,
  selectGameWinner,
  winnerDrafts,
  type GameWinner,
} from "@/lib/score-entry";
import styles from "./staff-manual.module.css";

export function StaffScoringPractice() {
  const id = useId();
  const [length, setLength] = useState("3");
  const [bestOf, setBestOf] = useState(3);
  const [drafts, setDrafts] = useState(() => winnerDrafts([], 3));
  const result = readGameWinners(drafts, bestOf);
  const valid = isValidBestOf(Number(length)) && length.trim() !== "";
  const visible = result.outcome
    ? result.games.length
    : Math.min(bestOf, result.games.length + 1);

  function pick(index: number, winner: GameWinner | null) {
    setDrafts((current) => selectGameWinner(current, index, winner, bestOf));
  }

  return (
    <section className={styles.practice} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Try any scoring combination</h3>
      <p>Practice only. These choices never save to a match.</p>
      <label htmlFor={`${id}-length`}>
        Best of (games)
        <input
          id={`${id}-length`}
          type="number"
          min={1}
          max={99}
          step={2}
          value={length}
          aria-invalid={!valid}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            const next = event.target.value;
            setLength(next);
            if (next.trim() !== "" && isValidBestOf(Number(next))) {
              setBestOf(Number(next));
              setDrafts(winnerDrafts([], Number(next)));
            }
          }}
        />
      </label>
      <p id={`${id}-help`} className={styles.footnote}>
        Enter an odd whole number from 1 to 99. Changing the length resets this
        example.
      </p>
      {!valid && <p role="alert">Choose a valid best-of length to continue.</p>}
      {drafts.slice(0, visible).map((game, index) => (
        <fieldset key={index} disabled={!valid}>
          <legend>Game {index + 1}</legend>
          <div className={styles.gameButtons}>
            {(["A", "B"] as const).map((side) => (
              <button
                key={side}
                type="button"
                aria-label={`Practice: Player ${side} wins Game ${index + 1}`}
                aria-pressed={game.winner === side}
                onClick={() => pick(index, side)}
              >
                Player {side}
                {game.winner === side ? " - Winner" : ""}
              </button>
            ))}
            {game.winner && (
              <button type="button" onClick={() => pick(index, null)}>
                Clear Game {index + 1} & later games
              </button>
            )}
          </div>
        </fieldset>
      ))}
      <p className={styles.status} role="status" aria-live="polite">
        Player A {result.winsA} - {result.winsB} Player B.{" "}
        {result.outcome
          ? `Player ${result.outcome === "A_WIN" ? "A" : "B"} wins. League points: winner 3, loser 0.`
          : `First to ${result.needed} game wins. Continue with the next game.`}
      </p>
      <button
        type="button"
        className="button secondary small"
        onClick={() => setDrafts(winnerDrafts([], bestOf))}
      >
        Reset practice
      </button>
    </section>
  );
}
