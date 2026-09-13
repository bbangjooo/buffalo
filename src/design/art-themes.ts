/** Art direction and time of day are separate preferences. */
export type ArtTheme = 'ink' | 'classic';
export const ART_THEME_STORAGE_KEY = 'bbangjo.art-theme';

export function isArtTheme(value: unknown): value is ArtTheme {
  return value === 'ink' || value === 'classic';
}

export function readArtTheme(): ArtTheme {
  try {
    const value = localStorage.getItem(ART_THEME_STORAGE_KEY);
    return isArtTheme(value) ? value : 'ink';
  } catch { return 'ink'; }
}

export function writeArtTheme(theme: ArtTheme): void {
  try { localStorage.setItem(ART_THEME_STORAGE_KEY, theme); } catch { /* Preference storage is optional. */ }
}
