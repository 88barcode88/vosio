import type { ReactNode } from "react";
import { VosioWorkspace } from "@/components/vosio-workspace";
import type { WorkspaceView } from "@/lib/workspace-data";

// WorkspaceLoading reuses navigation and content geometry during loading or a recoverable route failure.
export function WorkspaceLoading({ children, view }: { children: ReactNode; view: WorkspaceView }) {
  return <VosioWorkspace aiOutputs={[]} recordings={[]} transcripts={[]} userEmail="" view={view} pendingContent={children} />;
}
