"use client";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DialogActions, useDialogForm } from "./workspace-dialog";
import { validateSeries, type Rules } from "@/lib/domain";
import { friendlyError } from "@/lib/staff-presentation";
import { staffRequest } from "@/lib/staff-request";
import { evidenceSizeError } from "@/lib/evidence-policy";
import { Check } from "lucide-react";
import {
  readGameWinners,
  selectGameWinner,
  winnerDrafts,
  type GameWinner,
  type WinnerDraft,
} from "@/lib/score-entry";

type ResultType = "played" | "DRAW" | "A_FORFEIT" | "B_FORFEIT";
export function MatchResultForm({
  matchId,
  bestOf,
  sideA,
  sideB,
  rules,
  confirmedRules,
  initialResult,
  blockedReason,
  knockout = false,
}: {
  matchId: string;
  bestOf: number;
  sideA: string;
  sideB: string;
  rules: Rules;
  confirmedRules: string[];
  initialResult?: {
    outcome: string;
    status?: string;
    games: { scoreA: number; scoreB: number }[];
  };
  blockedReason?: string;
  knockout?: boolean;
}) {
  const uid = useId(),
    router = useRouter();
  const needed = Math.floor(bestOf / 2) + 1;
  const initialType: ResultType =
    initialResult &&
    ["DRAW", "A_FORFEIT", "B_FORFEIT"].includes(initialResult.outcome)
      ? (initialResult.outcome as ResultType)
      : "played";
  const [resultType, setResultType] = useState<ResultType>(initialType);
  const [includeGames, setIncludeGames] = useState(
    initialType === "DRAW" || Boolean(initialResult?.games.length),
  );
  const [drafts, setDrafts] = useState<WinnerDraft[]>(() =>
    winnerDrafts(initialResult?.games ?? [], bestOf),
  );
  const [file, setFile] = useState<File | null>(null);
  const [advance, setAdvance] = useState(knockout);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const dialogForm = useDialogForm(busy);
  const submission = useRef<{
    signature: string;
    key: string;
    resultId?: string;
    uploadedFile?: File;
    accepted?: boolean;
  } | null>(null);
  const needsReason =
    resultType.includes("FORFEIT") || initialResult?.status === "ACCEPTED";
  const showGames = resultType === "played" || includeGames;
  let scores: ReturnType<typeof readGameWinners> | null = null,
    scoreError = "";
  try {
    scores = readGameWinners(showGames ? drafts : [], bestOf);
  } catch (error) {
    scoreError =
      error instanceof Error
        ? friendlyError(error.message)
        : "Check the game winners.";
  }
  const rulesReady =
    confirmedRules.includes("drawPolicy") &&
    confirmedRules.includes("seriesPoints");
  const unavailable =
    blockedReason ??
    (!rulesReady
      ? "An admin needs to confirm the scoring and draw rules before this result can be submitted."
      : undefined);
  const allowDraw =
    confirmedRules.includes("drawPolicy") &&
    rules.drawPolicy === "moderated_draw";
  const allowForfeit =
    confirmedRules.includes("specialOutcomes") &&
    rules.specialOutcomes === "forfeit";
  const winner =
    resultType === "A_FORFEIT"
      ? sideB
      : resultType === "B_FORFEIT"
        ? sideA
        : scores?.outcome === "A_WIN"
          ? sideA
          : scores?.outcome === "B_WIN"
            ? sideB
            : null;
  const visibleGames = scores?.outcome
    ? scores.games.length
    : Math.min(bestOf, (scores?.games.length ?? 0) + 1);
  function pickWinner(index: number, winner: GameWinner | null) {
    setDrafts((current) => selectGameWinner(current, index, winner, bestOf));
    setFeedback(null);
  }
  return (
    <form
      id={uid}
      className="form match-result-form"
      onChange={dialogForm.onChange}
      onClick={dialogForm.onClick}
      onSubmit={async (event) => {
        event.preventDefault();
        setFeedback(null);
        if (unavailable) {
          setFeedback({ text: unavailable, error: true });
          return;
        }
        try {
          const entry = readGameWinners(showGames ? drafts : [], bestOf);
          const outcome = resultType === "played" ? entry.outcome : resultType;
          if (!outcome)
            throw new Error(
              `Pick each game’s winner until a player wins ${needed} games.`,
            );
          validateSeries(bestOf, entry.games, outcome, rules, confirmedRules);
          const note = reason.trim();
          if (needsReason && note.length < 3)
            throw new Error(
              "Explain the forfeit or correction with at least three characters.",
            );
          const data = { matchId, outcome, games: entry.games, reason: note };
          const signature = JSON.stringify(data);
          if (submission.current?.signature !== signature)
            submission.current = { signature, key: crypto.randomUUID() };
          const confirm =
            (event.nativeEvent as SubmitEvent).submitter instanceof
              HTMLButtonElement &&
            ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)
              .value === "confirm";
          if (file) {
            const problem = evidenceSizeError(file.size);
            if (problem) throw new Error(problem);
          }
          setBusy(true);
          const attempt = submission.current!;
          if (!attempt.resultId) {
            const body = await staffRequest<{ id: string }>("result", {
              ...data,
              idempotencyKey: attempt.key,
            });
            attempt.resultId = body.id;
          }
          if (file && attempt.uploadedFile !== file) {
            const form = new FormData();
            form.set("action", "evidence");
            form.set("resultId", attempt.resultId);
            form.set("file", file);
            const upload = await fetch("/api/staff", {
              method: "POST",
              body: form,
            });
            const body = await upload.json();
            if (!upload.ok)
              throw new Error(
                body.error ??
                  "Screenshot upload failed. Retry to finish this saved result.",
              );
            attempt.uploadedFile = file;
          }
          if (confirm && !attempt.accepted) {
            await staffRequest("resultReview", {
              id: attempt.resultId,
              action: "ACCEPT",
              reason: note,
            });
            attempt.accepted = true;
          }
          if (confirm && knockout && advance)
            await staffRequest("advance", { matchId, reason: note });
          setFeedback({
            text: confirm
              ? attempt.uploadedFile
                ? "Result and screenshot saved and confirmed."
                : "Result saved and confirmed."
              : "Result saved for review.",
            error: false,
          });
          dialogForm.onSaved();
          router.refresh();
        } catch (error) {
          setFeedback({
            text:
              error instanceof Error
                ? friendlyError(error.message)
                : "Unable to submit the result. Please try again.",
            error: true,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="score-entry-help" id={`${uid}-help`}>
        Best of {bestOf} · First to {needed} game wins. Tap the player who won
        each game.
      </p>
      {unavailable && <p className="notice">{unavailable}</p>}
      <fieldset
        className="score-entry-fields"
        disabled={busy || Boolean(blockedReason)}
      >
        <label htmlFor={`${uid}-type`}>
          Match result
          <select
            id={`${uid}-type`}
            value={resultType}
            onChange={(event) => {
              const nextType = event.target.value as ResultType;
              setResultType(nextType);
              if (nextType === "DRAW") setIncludeGames(true);
              setFeedback(null);
            }}
          >
            <option value="played">Played · Pick each game’s winner</option>
            {allowDraw && <option value="DRAW">Draw</option>}
            {allowForfeit && (
              <>
                <option value="A_FORFEIT">{sideA} forfeited</option>
                <option value="B_FORFEIT">{sideB} forfeited</option>
              </>
            )}
          </select>
        </label>
        {resultType !== "played" && (
          <label className="score-entry-toggle">
            <input
              type="checkbox"
              checked={includeGames}
              onChange={(event) => {
                setIncludeGames(event.target.checked);
                setFeedback(null);
              }}
            />
            Record games played before the{" "}
            {resultType === "DRAW" ? "draw" : "forfeit"}
          </label>
        )}
        {showGames && (
          <div className="score-entry-games" aria-describedby={`${uid}-help`}>
            {drafts.slice(0, visibleGames).map((game, index) => (
              <fieldset className="score-entry-game" key={index}>
                <legend>Game {index + 1}</legend>
                <div className="score-entry-pair">
                  {(["A", "B"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      className="score-entry-winner"
                      aria-pressed={game.winner === side}
                      aria-label={`Pick ${side === "A" ? sideA : sideB} as winner of Game ${index + 1}`}
                      onClick={() => pickWinner(index, side)}
                    >
                      <span>{side === "A" ? sideA : sideB}</span>
                      <small>
                        {game.winner === side ? (
                          <>
                            <Check size={16} aria-hidden="true" /> Winner
                          </>
                        ) : (
                          "Pick winner"
                        )}
                      </small>
                    </button>
                  ))}
                </div>
                {game.winner && (
                  <button
                    type="button"
                    className="score-entry-clear"
                    aria-label={`Clear Game ${index + 1} and later games`}
                    onClick={() => pickWinner(index, null)}
                  >
                    Clear this game & later games
                  </button>
                )}
              </fieldset>
            ))}
          </div>
        )}
        <div
          className={`score-entry-summary ${scoreError ? "has-error" : ""}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {scoreError ? (
            scoreError
          ) : (
            <>
              <span className="score-entry-summary-label">Series result</span>
              {showGames && (
                <strong>
                  {sideA} {scores?.winsA ?? 0} – {scores?.winsB ?? 0} {sideB}
                </strong>
              )}
              <span>
                {resultType === "DRAW"
                  ? "Draw — requires review."
                  : winner
                    ? `${winner} wins${resultType === "played" ? "." : " by forfeit."}`
                    : `Pick each game’s winner. First to ${needed} wins the match.`}
              </span>
            </>
          )}
        </div>
        <label htmlFor={`${uid}-reason`}>
          {needsReason ? "Reason for forfeit / correction" : "Note (optional)"}
          <textarea
            id={`${uid}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={needsReason ? 3 : undefined}
            maxLength={1000}
            required={needsReason}
            placeholder={
              needsReason
                ? "Explain what you are correcting."
                : "For example: Winners checked against the match screenshot."
            }
          />
        </label>
        <label htmlFor={`${uid}-screenshot`}>
          Match screenshot (optional · PNG, JPEG or WebP, up to 4 MB)
          <input
            id={`${uid}-screenshot`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setFeedback(null);
            }}
          />
        </label>
        {knockout && (
          <label>
            <input
              type="checkbox"
              checked={advance}
              onChange={(e) => setAdvance(e.target.checked)}
            />
            Advance the confirmed winner
          </label>
        )}
      </fieldset>
      <DialogActions>
        <div>
          {feedback && (
            <div
              role={feedback.error ? "alert" : "status"}
              className={`feedback ${feedback.error ? "error" : ""}`}
            >
              {feedback.text}
            </div>
          )}
          <div className="row">
            <button
              form={uid}
              type="submit"
              value="confirm"
              className="button small"
              disabled={busy || Boolean(unavailable)}
            >
              {busy ? "Saving…" : "Save & confirm"}
            </button>
            <button
              form={uid}
              type="submit"
              value="review"
              className="button secondary small"
              disabled={busy || Boolean(unavailable)}
            >
              {busy ? "Saving…" : "Save for review"}
            </button>
          </div>
        </div>
      </DialogActions>
      <p className="muted text-xs">
        Game winners, evidence and staff decisions are recorded automatically. A
        saved result remains available if an upload needs retrying.
      </p>
    </form>
  );
}
