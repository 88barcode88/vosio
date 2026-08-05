"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { SaveActionState } from "@/lib/forms/save-action-state";

type CloseOnSuccessfulSaveOptions = {
  actionState: SaveActionState;
  close: () => void;
  currentScopeKey: string;
  triggerRef: RefObject<HTMLElement | null>;
};

// Closes an editor once for each new successful settlement in its current scope.
export function useCloseOnSuccessfulSave({
  actionState,
  close,
  currentScopeKey,
  triggerRef
}: CloseOnSuccessfulSaveOptions): void {
  const handledRevisionRef = useRef(0);

  useEffect(() => {
    if (
      actionState.status !== "success"
      || actionState.scopeKey !== currentScopeKey
      || actionState.revision <= handledRevisionRef.current
    ) {
      return;
    }

    handledRevisionRef.current = actionState.revision;
    close();
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [actionState, close, currentScopeKey, triggerRef]);
}
