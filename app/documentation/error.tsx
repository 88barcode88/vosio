"use client";

import { WorkspaceLoading } from "@/components/workspace/loading";

import { UtilityRouteError } from "@/components/utility-route-error";

// DocumentationError owns recoverable loading failures for the documentation route.
export default function DocumentationError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <WorkspaceLoading view="documentation"><UtilityRouteError {...props} title="Dokumentaci se nepodařilo načíst" /></WorkspaceLoading>;
}
