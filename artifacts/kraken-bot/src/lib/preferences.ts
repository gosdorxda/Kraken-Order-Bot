import { useState, useEffect } from "react";

const THEME_KEY = "krkn-theme";
const FONT_KEY  = "krkn-font";

export type Theme = "dark" | "light";

export interface FontOption {
  label: string;
  value: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { label: "Inter (Default)", value: "'Inter', sans-serif" },
  { label: "Space Mono",      value: "'Space Mono', monospace" },
  { label: "System UI",       value: "system-ui, sans-serif" },
];

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme | null) ?? "dark"
  );

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggleTheme };
}

export function useFont() {
  const [font, setFontState] = useState<string>(
    () => localStorage.getItem(FONT_KEY) ?? FONT_OPTIONS[0]!.value
  );

  useEffect(() => {
    document.documentElement.style.setProperty("--app-font-sans", font);
    localStorage.setItem(FONT_KEY, font);
  }, [font]);

  return { font, setFont: setFontState, options: FONT_OPTIONS };
}
