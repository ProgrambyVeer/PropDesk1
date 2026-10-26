export type ThemePref = 'light' | 'dark';
const KEY = 'pc_theme';

// Dark is the default; only an explicitly saved 'light' switches it off (legacy 'system' values fall back to dark).
export const getThemePref = (): ThemePref => {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
};

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === 'dark';
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0A0A0B' : '#FFFFFF');
}

export function setThemePref(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* storage unavailable: applies for this session only */ }
  applyTheme(pref);
}

export function initTheme() {
  applyTheme();
}
