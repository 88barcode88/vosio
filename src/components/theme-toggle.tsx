"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  normalizeTheme,
  type ThemeMode,
  VOSIO_THEME_COOKIE,
  VOSIO_THEME_STORAGE_KEY
} from "@/lib/theme";

type ThemeToggleProps = {
  compact?: boolean;
};

// getInitialTheme reads the stored UI theme without blocking server rendering.
function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }

  const storedTheme = window.localStorage.getItem(VOSIO_THEME_STORAGE_KEY);

  return normalizeTheme(storedTheme ?? document.documentElement.dataset.theme);
}

// applyTheme writes the active theme to the document root, localStorage and the server-readable cookie.
function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(VOSIO_THEME_STORAGE_KEY, theme);
  document.cookie = `${VOSIO_THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

// ThemeToggle switches Vosio between light and dark working modes.
export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

  useEffect(() => {
    const initialTheme = getInitialTheme();

    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  // toggleTheme flips the persisted UI theme.
  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";

    setTheme(nextTheme);
    applyTheme(nextTheme);
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
