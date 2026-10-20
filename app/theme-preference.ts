import type { UserProfile } from "./user-profile";

export type Theme = "light" | "dark";

// Keep in sync with --page in globals.css so the browser bar matches the page.
export const THEME_COLORS = { light: "#ffffff", dark: "#121212" } as const;

/** Signing in with a `dark ` prefix picks the dark theme; everyone else gets light. */
export function themeForProfile(profile: UserProfile | null): Theme {
  return profile?.darkMode === true ? "dark" : "light";
}
