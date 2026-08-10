"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  getServerThemeSnapshot,
  getThemeSnapshot,
  setThemeSnapshot,
  subscribeToTheme
} from "@/lib/theme";

type ThemeToggleProps = {
  compact?: boolean;
};

// ThemeToggle switches Vosio between light and dark working modes.
export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  );

  // toggleTheme flips the persisted UI theme.
  function toggleTheme() {
    const nextTheme = getThemeSnapshot() === "dark" ? "light" : "dark";
    setThemeSnapshot(nextTheme);
  }

  return (
    <button
      aria-label={theme === "dark" ? "Přepnout na světlý režim" : "Přepnout na tmavý režim"}
      className={compact ? "theme-toggle theme-toggle-compact" : "theme-toggle"}
      onClick={toggleTheme}
      type="button"
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      {compact ? null : <span>{theme === "dark" ? "Světlý" : "Tmavý"}</span>}
    </button>
  );
}
