"use client";

import { useEffect } from "react";
import {
  normalizeTheme,
  setThemeSnapshot,
  VOSIO_THEME_STORAGE_KEY
} from "@/lib/theme";

// ThemeStorageMigration carries pre-cookie localStorage preferences into the cookie-backed theme once.
export function ThemeStorageMigration() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.themeSource !== "default") return;

    root.dataset.themeSource = "migrated";
    let storedTheme: string | null = null;
    try {
      storedTheme = window.localStorage.getItem(VOSIO_THEME_STORAGE_KEY);
    } catch {
      // The server-rendered default remains usable when browser storage is unavailable.
    }

    setThemeSnapshot(
      storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : normalizeTheme(root.dataset.theme)
    );
  }, []);

  return null;
}
