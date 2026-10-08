"use client";

import { useState } from "react";

type StageChoice = {
  id: string;
  label: string;
  rounds: { number: number; label: string }[];
};

export function FixtureStageFields({
  stages,
  selectedStageId,
  selectedRound,
}: {
  stages: StageChoice[];
  selectedStageId: string;
  selectedRound?: number;
}) {
  const [stageId, setStageId] = useState(selectedStageId);
  const [round, setRound] = useState(String(selectedRound ?? ""));
  const stage = stages.find((choice) => choice.id === stageId);

  return (
    <div className="grid2">
      <label htmlFor="fixture-stage">
        Tournament / stage
        <select
          id="fixture-stage"
          name="stageId"
          value={stageId}
          onChange={(event) => {
            const nextStage = stages.find(
              (choice) => choice.id === event.target.value,
            );
            setStageId(event.target.value);
            setRound(String(nextStage?.rounds[0]?.number ?? ""));
          }}
        >
          {stages.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="fixture-round">
        Round
        <select
          id="fixture-round"
          name="round"
          value={round}
          disabled={!stage?.rounds.length}
          onChange={(event) => setRound(event.target.value)}
        >
          {!stage?.rounds.length && <option value="">No rounds yet</option>}
          {stage?.rounds.map((choice) => (
            <option key={choice.number} value={choice.number}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
