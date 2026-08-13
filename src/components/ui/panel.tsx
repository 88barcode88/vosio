import type { ComponentPropsWithoutRef } from "react";

type PanelProps = ComponentPropsWithoutRef<"section">;

// Panel provides a neutral semantic surface without attaching product behavior or data.
export function Panel({ className, ...props }: PanelProps) {
  return <section className={["ui-panel", className].filter(Boolean).join(" ")} {...props} />;
}
