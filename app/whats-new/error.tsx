"use client";

import { WorkspaceLoading } from "@/components/workspace/loading";
import { UtilityRouteError } from "@/components/utility-route-error";

// WhatsNewError owns recoverable loading failures for the release notes route.
export default function WhatsNewError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <WorkspaceLoading view="whats-new"><UtilityRouteError {...props} title="Novinky se nepodařilo načíst" /></WorkspaceLoading>;
}
