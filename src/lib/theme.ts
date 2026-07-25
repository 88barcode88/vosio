export type ThemeMode = "dark" | "light";

export const VOSIO_THEME_COOKIE = "vosio-theme";
export const VOSIO_THEME_STORAGE_KEY = "vosio-theme";

// normalizeTheme maps untrusted persisted values into the supported Vosio theme modes.
export function normalizeTheme(value: string | null | undefined): ThemeMode {
  return value === "light" ? "light" : "dark";
}
