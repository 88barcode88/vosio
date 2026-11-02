"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

type NavigationPresentation = { canManageTeam: boolean; userEmail: string };
const emptyPresentation: NavigationPresentation = { canManageTeam: false, userEmail: "" };
const NavigationMemory = createContext<{
  confirmed: NavigationPresentation | null;
  remember: (presentation: NavigationPresentation) => void;
} | null>(null);

// isWorkspacePath limits transient presentation reuse to workspace routes and guarded development fixtures.
function isWorkspacePath(pathname: string | null) {
  return /^\/(recordings|settings|team|templates|trash|documentation|ai)(\/|$)/.test(pathname ?? "")
    || (process.env.NODE_ENV === "development" && /^\/login\/(workspace-loading-e2e|workspace-shell-e2e|recording-layout-e2e|team-e2e)(\/|$)/.test(pathname ?? ""));
}

// WorkspaceNavigationProvider owns presentation continuity across route loading boundaries.
export function WorkspaceNavigationProvider({ children }: { children: ReactNode }) {
  const workspacePath = isWorkspacePath(usePathname());
  const [confirmed, setConfirmed] = useState<NavigationPresentation | null>(null);
  const remember = useCallback((presentation: NavigationPresentation) => {
    if (!workspacePath) return;
    setConfirmed((current) => current?.canManageTeam === presentation.canManageTeam && current.userEmail === presentation.userEmail
      ? current : presentation);
  }, [workspacePath]);

  // Leaving the authenticated workspace discards the display hint, including before another account signs in.
  useLayoutEffect(() => { if (!workspacePath) setConfirmed(null); }, [workspacePath]);
  const memory = useMemo(() => ({ confirmed: workspacePath ? confirmed : null, remember }), [confirmed, remember, workspacePath]);
  return <NavigationMemory.Provider value={memory}>{children}</NavigationMemory.Provider>;
}

// useWorkspaceNavigationPresentation retains only loading chrome; confirmed server values always win and authorize nothing here.
export function useWorkspaceNavigationPresentation(presentation: NavigationPresentation, pending: boolean) {
  const memory = useContext(NavigationMemory);
  const remember = memory?.remember;
  const { canManageTeam, userEmail } = presentation;
  useLayoutEffect(() => {
    if (!pending) remember?.({ canManageTeam, userEmail });
  }, [canManageTeam, pending, remember, userEmail]);
  return pending ? memory?.confirmed ?? emptyPresentation : presentation;
}
