"use client";
import { useId, useState } from "react";
import type { Choice } from "@/lib/staff-presentation";
import {
  friendlyLabel,
  metricChoices,
  ruleFields,
  sizeFields,
} from "@/lib/staff-presentation";
import type { TournamentConfiguration } from "@/lib/tournament-config";

export function SelectionField({
  name,
  label,
  options,
  value = [],
  max,
  help,
}: {
  name: string;
  label: string;
  options: Choice[];
  value?: string[];
  max?: number;
  help?: string;
}) {
  const uid = useId();
  const [selected, setSelected] = useState(value),
    [query, setQuery] = useState("");
  const visible = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <fieldset className="guided-field">
      <legend>{label}</legend>
      <input type="hidden" name={name} value={JSON.stringify(selected)} />
      {help && <p className="muted text-xs">{help}</p>}
      <label htmlFor={`${uid}-search`} className="sr-only">
        Search {label.toLowerCase()}
      </label>
      <input
        id={`${uid}-search`}
        type="search"
        placeholder="Search by player name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="selection-count" role="status">
        {selected.length}
        {max !== undefined ? ` of ${max}` : ""} selected
      </p>
      {selected.length > 0 && (
        <div className="selection-chips">
          {selected.map((id) => (
            <button
              type="button"
              key={id}
              onClick={() => setSelected(selected.filter((v) => v !== id))}
              aria-label={`Remove ${options.find((o) => o.value === id)?.label ?? "player"}`}
            >
              {options.find((o) => o.value === id)?.label ??
                "Unavailable player"}{" "}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      <div className="selection-options">
        {visible.map((o) => (
          <label className="choice-row" key={o.value}>
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              disabled={
                o.disabled ||
                (!selected.includes(o.value) &&
                  max !== undefined &&
                  selected.length >= max)
              }
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, o.value]
                    : selected.filter((v) => v !== o.value),
                )
              }
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {!visible.length && (
        <p className="muted text-sm">
          {options.length
            ? "No names match your search."
            : "No approved players are available yet. Review registrations first."}
        </p>
      )}
    </fieldset>
  );
}

export function OrderField({
  name,
  label,
  options,
  value = [],
  complete = false,
  help,
}: {
  name: string;
  label: string;
  options: Choice[];
  value?: string[];
  complete?: boolean;
  help?: string;
}) {
  const [order, setOrder] = useState(value),
    [query, setQuery] = useState("");
  function move(index: number, offset: number) {
    const next = [...order];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setOrder(next);
  }
  return (
    <fieldset className="guided-field">
      <legend>{label}</legend>
      <input type="hidden" name={name} value={JSON.stringify(order)} />
      <p className="muted text-xs">
        {help ??
          "Use Move up and Move down to put the first choice at the top."}
      </p>
      <ol className="ordered-choices">
        {order.map((id, i) => {
          const title =
            options.find((o) => o.value === id)?.label ?? "Unavailable choice";
          return (
            <li key={id}>
              <span className="order-number" aria-hidden="true">
                {i + 1}
              </span>
              <span className="order-name">{title}</span>
              <div className="order-buttons">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move ${title} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={i === order.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${title} down`}
                >
                  ↓
                </button>
                {!complete && (
                  <button
                    type="button"
                    onClick={() => setOrder(order.filter((v) => v !== id))}
                    aria-label={`Remove ${title}`}
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!complete && (
        <>
          <label>
            Find a choice to add
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
            />
          </label>
          <div className="selection-chips">
            {options
              .filter(
                (o) =>
                  !order.includes(o.value) &&
                  o.label.toLowerCase().includes(query.toLowerCase()),
              )
              .map((o) => (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => setOrder([...order, o.value])}
                >
                  + {o.label}
                </button>
              ))}
          </div>
        </>
      )}
      {!options.length && (
        <p className="muted text-sm">
          There are no entrants available for this step yet.
        </p>
      )}
    </fieldset>
  );
}

export function PairsField({
  name,
  label,
  options,
  count,
  matchesPerPlayer,
}: {
  name: string;
  label: string;
  options: Choice[];
  count: number;
  matchesPerPlayer?: number;
}) {
  const [pairs, setPairs] = useState<string[][]>(() =>
    Array.from({ length: count }, () => ["", ""]),
  );
  return (
    <fieldset className="guided-field">
      <legend>{label}</legend>
      <input type="hidden" name={name} value={JSON.stringify(pairs)} />
      <p className="muted text-xs">
        Choose two different players for each match. Each player must have{" "}
        {matchesPerPlayer} matches, with a different opponent each time.
      </p>
      {pairs.map((pair, i) => (
        <div className="pair-choice" key={i}>
          <strong>Match {i + 1}</strong>
          {[0, 1].map((side) => (
            <label key={side}>
              {side === 0 ? "First player" : "Opponent"}
              <select
                required
                value={pair[side]}
                onChange={(e) =>
                  setPairs(
                    pairs.map((p, n) =>
                      n === i
                        ? p.map((v, s) => (s === side ? e.target.value : v))
                        : p,
                    ),
                  )
                }
              >
                <option value="">Choose a player</option>
                {options.map((o) => (
                  <option
                    key={o.value}
                    value={o.value}
                    disabled={o.value === pair[1 - side]}
                  >
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ))}
      <div className="muted text-xs">
        {options.map((o) => (
          <p key={o.value}>
            {o.label}: {pairs.flat().filter((v) => v === o.value).length} of{" "}
            {matchesPerPlayer} matches
          </p>
        ))}
      </div>
      {!options.length && (
        <p className="notice">
          Save the final league rankings first to see playoff players here.
        </p>
      )}
    </fieldset>
  );
}

export function SizesFields({
  configuration,
}: {
  configuration: TournamentConfiguration;
}) {
  return (
    <>
      <div className="grid2">
        {sizeFields.map(([key, label, min]) => (
          <label key={key}>
            {label}
            {key === "soloBracketSize" || key === "teamBracketSize" ? (
              <select name={key} defaultValue={configuration[key]}>
                {[2, 4, 8, 16, 32, 64, 128, 256].map((n) => (
                  <option key={n} value={n}>
                    {n} places
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                name={key}
                defaultValue={configuration[key]}
                min={min}
                max={key.includes("MatchesPerPlayer") ? 255 : 256}
                step={1}
                required
              />
            )}
          </label>
        ))}
      </div>
      <label>
        League rest rounds
        <select
          name="leagueByePolicy"
          defaultValue={configuration.leagueByePolicy}
        >
          <option value="none">
            Everyone plays each round (even player count)
          </option>
          <option value="rotating_no_points">
            Everyone takes one rest round; no points awarded
          </option>
        </select>
      </label>
      <label>
        Knockout places without an opponent
        <select
          name="bracketByePolicy"
          defaultValue={configuration.bracketByePolicy}
        >
          <option value="none">Every entrant has an opponent</option>
          <option value="seeded_top">
            Top-ranked entrants advance without playing
          </option>
        </select>
      </label>
      <p className="muted text-xs">
        Players face each league opponent once at most. With an odd number of
        players, everyone faces all other players and takes one rest round.
      </p>
    </>
  );
}

export function RulesFields({
  rules,
  confirmed,
  stageKey,
  kind,
}: {
  rules: Record<string, unknown>;
  confirmed: string[];
  stageKey?: string;
  kind?: string;
}) {
  const visible = ruleFields.filter((f) =>
    f.key.startsWith("qualification")
      ? stageKey === "qualification"
      : f.key === "knockoutPairing"
        ? kind === "SOLO" && stageKey === "knockout"
        : f.key === "teamSeeding"
          ? kind === "TEAM"
          : f.key === "tiebreakers"
            ? stageKey === "league"
            : true,
  );
  return (
    <div className="stack">
      <p className="muted text-sm">
        Saving rules confirms your choices. Leave a rule blank to keep it
        undecided.
      </p>
      {visible.map((f) => (
        <fieldset className="rule-choice" key={f.key}>
          <legend>{f.label}</legend>
          {f.order ? (
            <OrderField
              name={`rule:${f.key}`}
              label="Priority order"
              options={metricChoices}
              value={(rules[f.key] as string[] | undefined) ?? []}
            />
          ) : f.choices ? (
            <label>
              <span className="sr-only">{f.label}</span>
              <select
                name={`rule:${f.key}`}
                defaultValue={
                  rules[f.key] === undefined ? "" : String(rules[f.key])
                }
              >
                <option value="">Choose a rule…</option>
                {f.choices.map((o) => (
                  <option value={o.value} key={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Deadline or timing
              <input
                name={`rule:${f.key}`}
                defaultValue={String(rules[f.key] ?? "")}
                placeholder="e.g. Within 24 hours of the match"
              />
            </label>
          )}
        </fieldset>
      ))}
      <input type="hidden" name="previousRules" value={JSON.stringify(rules)} />
      <input
        type="hidden"
        name="previousConfirmed"
        value={JSON.stringify(confirmed)}
      />
    </div>
  );
}

export function MappingFields({ value }: { value: Record<string, string> }) {
  return (
    <fieldset className="guided-field">
      <legend>Match your spreadsheet columns</legend>
      <p className="muted text-xs">
        Enter the column heading exactly as it appears in your registration
        spreadsheet.
      </p>
      {[
        ["ign", "Player name", "IGN"],
        ["phone", "WhatsApp number", "Whatsapp Number"],
        ["country", "Country", "Country"],
      ].map(([key, label, placeholder]) => (
        <label key={key}>
          {label}
          <input
            name={`mapping:${key}`}
            required
            defaultValue={value[key] ?? ""}
            placeholder={placeholder}
          />
        </label>
      ))}
    </fieldset>
  );
}
