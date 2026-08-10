export type ThemeMode = "dark" | "light";

export const VOSIO_THEME_COOKIE = "vosio-theme";
export const VOSIO_THEME_STORAGE_KEY = "vosio-theme";
export const VOSIO_THEME_CHANGE_EVENT = "vosio-theme-change";

const themeListeners = new Set<() => void>();
let browserListenersAttached = false;

// normalizeTheme maps untrusted persisted values into the supported Vosio theme modes.
export function normalizeTheme(value: string | null | undefined): ThemeMode {
  return value === "light" ? "light" : "dark";
}

// getThemeSnapshot reads the browser-backed theme shared by every mounted toggle.
export function getThemeSnapshot(): ThemeMode {
  if (typeof window === "undefined") return "dark";

  try {
    return normalizeTheme(
      window.localStorage.getItem(VOSIO_THEME_STORAGE_KEY)
      ?? document.documentElement.dataset.theme
    );
  } catch {
    return normalizeTheme(document.documentElement.dataset.theme);
  }
}

// getServerThemeSnapshot keeps the server and first hydration render stable.
export function getServerThemeSnapshot(): ThemeMode {
  return "dark";
}

// notifyThemeListeners updates every useSyncExternalStore consumer in this document.
function notifyThemeListeners() {
  for (const listener of themeListeners) listener();
}

// handleThemeChange synchronizes document state after an in-document theme event.
function handleThemeChange(event: Event) {
  const nextTheme = event instanceof CustomEvent
    ? normalizeTheme(event.detail)
    : getThemeSnapshot();

  document.documentElement.dataset.theme = nextTheme;
  notifyThemeListeners();
}

// handleThemeStorage synchronizes this document when another browser context changes theme.
function handleThemeStorage(event: StorageEvent) {
  if (event.key !== VOSIO_THEME_STORAGE_KEY) return;

  document.documentElement.dataset.theme = normalizeTheme(event.newValue);
  notifyThemeListeners();
}

// attachBrowserListeners installs one shared event bridge for all toggle instances.
function attachBrowserListeners() {
  if (browserListenersAttached || typeof window === "undefined") return;

  window.addEventListener(VOSIO_THEME_CHANGE_EVENT, handleThemeChange);
  window.addEventListener("storage", handleThemeStorage);
  browserListenersAttached = true;
}

// detachBrowserListeners removes the bridge after the final toggle unmounts.
function detachBrowserListeners() {
  if (!browserListenersAttached || typeof window === "undefined") return;

  window.removeEventListener(VOSIO_THEME_CHANGE_EVENT, handleThemeChange);
  window.removeEventListener("storage", handleThemeStorage);
  browserListenersAttached = false;
}

// subscribeToTheme connects React consumers to both local and cross-context changes.
export function subscribeToTheme(listener: () => void) {
  themeListeners.add(listener);
  attachBrowserListeners();

  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0) detachBrowserListeners();
  };
}

// setThemeSnapshot persists a theme and broadcasts it without replacing mounted buttons.
export function setThemeSnapshot(theme: ThemeMode) {
  if (typeof window === "undefined") return;

  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(VOSIO_THEME_STORAGE_KEY, theme);
  } catch {
    // The document theme remains usable when browser storage is unavailable.
  }
  document.cookie = `${VOSIO_THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(VOSIO_THEME_CHANGE_EVENT, { detail: theme }));
}
