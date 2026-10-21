export type Theme = "dark" | "light";

const KEY = "firescout.theme";

/** A stored theme, or dark (the default) for anything else. */
export function parseTheme(value: string | null): Theme {
  return value === "light" ? "light" : "dark";
}

/** The viewer's saved theme; storage can be unavailable (private window), so it never throws. */
export function loadTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not remembered; the toggle still works for this visit.
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
