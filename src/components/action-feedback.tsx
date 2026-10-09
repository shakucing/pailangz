"use client";

import { ArrowUpRight } from "lucide-react";
import { TaskDialogButton } from "./workspace-dialog";

export type FeedbackAction = {
  when: string;
  label?: string;
  target: string;
  fieldTarget?: string;
};

export function ActionFeedback({
  text,
  error,
  actions = [],
}: {
  text: string;
  error: boolean;
  actions?: FeedbackAction[];
}) {
  const available = error
    ? actions.filter((action) => text.includes(action.when))
    : [];
  const direct = available.length === 1 && text === available[0].when;
  const actionButton = (action: FeedbackAction, label: string) => (
    <TaskDialogButton
      key={`${action.target}-${action.fieldTarget}`}
      target={action.target}
      fieldTarget={action.fieldTarget}
      className="feedback-action"
    >
      <span>{label}</span>
      <ArrowUpRight size={16} aria-hidden="true" />
    </TaskDialogButton>
  );
  return (
    <div
      role={error ? "alert" : "status"}
      className={`feedback${error ? " error" : ""}`}
    >
      {direct ? (
        actionButton(available[0], text)
      ) : (
        <>
          {text}
          {available.length > 0 && (
            <div className="feedback-actions">
              {available.map((action) =>
                actionButton(action, action.label ?? action.when),
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
