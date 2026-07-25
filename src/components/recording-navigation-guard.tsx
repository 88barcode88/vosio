"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

const RECORDING_NAVIGATION_MESSAGE = "Probíhá nahrávání nebo ukládání. Opravdu chcete opustit stránku?";

type NavigationConfirmation = (message: string) => boolean;

type NavigationBlockerOptions = {
  blockInternalNavigation?: boolean;
};

type NavigationBlockerState = {
  blocksInternalNavigation: boolean;
  hasNavigationBlockers: boolean;
};

type NavigationBlockerRegistry = {
  blocksInternalNavigation: () => boolean;
  hasNavigationBlockers: () => boolean;
  registerNavigationBlocker: (options?: NavigationBlockerOptions) => () => void;
};

type RecordingNavigationGuardContextValue = {
  registerNavigationBlocker: (options?: NavigationBlockerOptions) => () => void;
};

const RecordingNavigationGuardContext = createContext<RecordingNavigationGuardContextValue | null>(null);

// confirmRecordingNavigation asks whether leaving during an active recording is intentional.
export function confirmRecordingNavigation(confirm: NavigationConfirmation = window.confirm.bind(window)) {
  return confirm(RECORDING_NAVIGATION_MESSAGE);
}

// handleRecordingBeforeUnload activates the browser-native warning for active recordings.
export function handleRecordingBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";

  return "";
}

// isGuardableNavigationClick accepts only ordinary same-origin page-changing anchor clicks.
export function isGuardableNavigationClick(
  event: MouseEvent,
  navigationLink?: HTMLAnchorElement | null
) {
  const link = navigationLink ?? getNavigationLink(event);

  if (
    !link ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    link.hasAttribute("download") ||
    link.target.toLowerCase() === "_blank"
  ) {
    return false;
  }

  const destination = new URL(link.href, window.location.href);

  return destination.origin === window.location.origin &&
    (destination.pathname !== window.location.pathname || destination.search !== window.location.search);
}

// handleRecordingNavigationClick stops navigation when the user declines the recording warning.
export function handleRecordingNavigationClick(
  event: MouseEvent,
  confirm: () => boolean = confirmRecordingNavigation
) {
  if (!isGuardableNavigationClick(event) || confirm()) {
    return false;
  }

  event.preventDefault();

  return true;
}

// handleRecordingNavigationSubmit stops only forms explicitly marked as navigation guards.
export function handleRecordingNavigationSubmit(
  event: SubmitEvent,
  confirm: () => boolean = confirmRecordingNavigation
) {
  const form = event.target instanceof HTMLFormElement ? event.target : null;

  if (form?.dataset.navigationGuard !== "true" || confirm()) {
    return false;
  }

  event.preventDefault();

  return true;
}

// createNavigationBlockerRegistry tracks independent blockers so one cleanup cannot clear another.
export function createNavigationBlockerRegistry(
  onChange: (state: NavigationBlockerState) => void = () => undefined
): NavigationBlockerRegistry {
  const blockerTokens = new Map<symbol, boolean>();

  // getState reports unload protection separately from internal-navigation protection.
  function getState(): NavigationBlockerState {
    return {
      blocksInternalNavigation: [...blockerTokens.values()].some(Boolean),
      hasNavigationBlockers: blockerTokens.size > 0
    };
  }

  return {
    blocksInternalNavigation: () => getState().blocksInternalNavigation,
    hasNavigationBlockers: () => blockerTokens.size > 0,
    registerNavigationBlocker: ({ blockInternalNavigation = true } = {}) => {
      const token = Symbol("recording-navigation-blocker");
      let disposed = false;

      blockerTokens.set(token, blockInternalNavigation);
      onChange(getState());

      return () => {
        if (disposed) {
          return;
        }

        disposed = true;
        blockerTokens.delete(token);
        onChange(getState());
      };
    }
  };
}

// RecordingNavigationGuardProvider installs navigation listeners only while a child blocks navigation.
export function RecordingNavigationGuardProvider({ children }: { children: ReactNode }) {
  const [blockerState, setBlockerState] = useState<NavigationBlockerState>({
    blocksInternalNavigation: false,
    hasNavigationBlockers: false
  });
  const [registry] = useState(() => createNavigationBlockerRegistry(setBlockerState));

  const registerNavigationBlocker = useCallback(
    (options?: NavigationBlockerOptions) => registry.registerNavigationBlocker(options),
    [registry]
  );
  const contextValue = useMemo(
    () => ({ registerNavigationBlocker }),
    [registerNavigationBlocker]
  );

  useEffect(() => {
    if (!blockerState.hasNavigationBlockers) {
      return;
    }

    const onClick = (event: MouseEvent) => handleRecordingNavigationClick(event);
    const onSubmit = (event: SubmitEvent) => handleRecordingNavigationSubmit(event);

    if (blockerState.blocksInternalNavigation) {
      document.addEventListener("click", onClick, true);
    }
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("beforeunload", handleRecordingBeforeUnload);

    return () => {
      if (blockerState.blocksInternalNavigation) {
        document.removeEventListener("click", onClick, true);
      }
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("beforeunload", handleRecordingBeforeUnload);
    };
  }, [blockerState]);

  return (
    <RecordingNavigationGuardContext.Provider value={contextValue}>
      {children}
    </RecordingNavigationGuardContext.Provider>
  );
}

// useRecordingNavigationBlocker gives recording controls access to the shared blocker registry.
export function useRecordingNavigationBlocker() {
  const context = useContext(RecordingNavigationGuardContext);

  if (!context) {
    throw new Error("useRecordingNavigationBlocker must be used within RecordingNavigationGuardProvider.");
  }

  return context;
}

// getNavigationLink resolves nested click targets to their containing navigation anchor.
function getNavigationLink(event: MouseEvent) {
  const target = event.target;

  return target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
}
