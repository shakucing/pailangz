"use client";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { validateSeries, type Rules } from "@/lib/domain";
import { friendlyError } from "@/lib/staff-presentation";
import { staffRequest } from "@/lib/staff-request";
import { evidenceSizeError } from "@/lib/evidence-policy";
import { readScoreEntry, type ScoreDraft } from "@/lib/score-entry";

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
    Boolean(initialResult?.games.length),
  );
  const [drafts, setDrafts] = useState<ScoreDraft[]>(() =>
    initialResult?.games.length
      ? initialResult.games.map((game) => ({
          scoreA: String(game.scoreA),
          scoreB: String(game.scoreB),
        }))
      : Array.from({ length: needed }, () => ({ scoreA: "", scoreB: "" })),
  );
  const [file, setFile] = useState<File | null>(null);
  const [advance, setAdvance] = useState(knockout);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
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
  let scores: ReturnType<typeof readScoreEntry> | null = null,
    scoreError = "";
  try {
    scores = readScoreEntry(showGames ? drafts : [], bestOf);
  } catch (error) {
    scoreError =
      error instanceof Error
        ? friendlyError(error.message)
        : "Check the game scores.";
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
  function changeScore(index: number, side: keyof ScoreDraft, value: string) {
    setDrafts((current) =>
      current.map((game, i) =>
        i === index ? { ...game, [side]: value } : game,
      ),
    );
    setFeedback(null);
  }
  return (
    <form
      className="form match-result-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setFeedback(null);
        if (unavailable) {
          setFeedback({ text: unavailable, error: true });
          return;
        }
        try {
          const entry = readScoreEntry(showGames ? drafts : [], bestOf);
          const outcome = resultType === "played" ? entry.outcome : resultType;
          if (!outcome)
            throw new Error(
              `Enter scores until a player wins ${needed} games. Add another game if needed.`,
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
          if (confirm && !file && !submission.current?.uploadedFile)
            throw new Error("Select a match screenshot before confirming.");
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
              ? "Result and screenshot saved and confirmed."
              : "Result saved for review.",
            error: false,
          });
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
        Best of {bestOf} · First to {needed} game wins. Enter the score shown at
        the end of each game.
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
              setResultType(event.target.value as ResultType);
              setFeedback(null);
            }}
          >
            <option value="played">Decide the winner from game scores</option>
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
            {drafts.map((game, index) => (
              <fieldset className="score-entry-game" key={index}>
                <legend>Game {index + 1}</legend>
                <div className="score-entry-pair">
                  {(["scoreA", "scoreB"] as const).map((side) => (
                    <label key={side} htmlFor={`${uid}-${index}-${side}`}>
                      <span>{side === "scoreA" ? sideA : sideB}</span>
                      <input
                        id={`${uid}-${index}-${side}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={100000}
                        step={1}
                        placeholder="Score"
                        value={game[side]}
                        aria-label={`Game ${index + 1} score for ${side === "scoreA" ? sideA : sideB}`}
                        onChange={(event) =>
                          changeScore(index, side, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="score-entry-actions">
              {drafts.length < bestOf && !scores?.outcome && (
                <button
                  type="button"
                  className="button small secondary"
                  onClick={() => {
                    setDrafts((current) => [
                      ...current,
                      { scoreA: "", scoreB: "" },
                    ]);
                    setFeedback(null);
                  }}
                >
                  + Add Game {drafts.length + 1}
                </button>
              )}
              {drafts.length > (resultType === "played" ? needed : 1) && (
                <button
                  type="button"
                  className="button small secondary"
                  onClick={() => {
                    setDrafts((current) => current.slice(0, -1));
                    setFeedback(null);
                  }}
                >
                  Remove Game {drafts.length}
                </button>
              )}
            </div>
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
                    : `Enter scores until one player wins ${needed} games.`}
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
                : "For example: Scores checked against the match screenshot."
            }
          />
        </label>
        <label htmlFor={`${uid}-screenshot`}>
          Match screenshot (PNG, JPEG or WebP, up to 4 MB)
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
          type="submit"
          value="confirm"
          className="button"
          disabled={busy || Boolean(unavailable) || !file}
        >
          {busy ? "Saving…" : "Save & confirm"}
        </button>
        <button
          type="submit"
          value="review"
          className="button secondary"
          disabled={busy || Boolean(unavailable)}
        >
          {busy ? "Saving…" : "Save for review"}
        </button>
      </div>
      <p className="muted text-xs">
        Scores, evidence and staff decisions are recorded automatically. A saved
        result remains available if an upload needs retrying.
      </p>
    </form>
  );
}
