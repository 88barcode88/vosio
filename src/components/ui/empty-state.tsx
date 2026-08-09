import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
};

// EmptyState explains an empty area and optionally presents one next action.
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <section className={["ui-empty-state", className].filter(Boolean).join(" ")}>
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div className="ui-empty-state-action">{action}</div> : null}
    </section>
  );
}
