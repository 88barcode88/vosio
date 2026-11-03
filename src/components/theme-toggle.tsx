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
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      {compact ? null : <span>{theme === "dark" ? "Světlý" : "Tmavý"}</span>}
    </button>
  );
}

const themeChoices = [
  { icon: Sun, id: "light", label: "Světlý" },
  { icon: Moon, id: "dark", label: "Tmavý" }
] as const;

// ThemeChoice shows both Vosio themes side by side for Settings and applies the pick immediately.
export function ThemeChoice() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  );

  return (
    <div aria-label="Motiv" className="theme-choice" role="group">
      {themeChoices.map(({ icon: Icon, id, label }) => (
        <button aria-pressed={theme === id} key={id} onClick={() => setThemeSnapshot(id)} type="button">
          <Icon aria-hidden="true" size={15} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
