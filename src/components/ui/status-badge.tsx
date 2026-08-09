import type { ReactNode } from "react";

type StatusBadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusBadgeTone;
};

// StatusBadge pairs every semantic state color with visible text supplied by its caller.
export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`ui-status ui-status-${tone}`}>{children}</span>;
}
