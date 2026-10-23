export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'pc_theme';

export const getThemePref = (): ThemePref => {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
};

const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === 'dark' || (pref === 'system' && mq().matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0A0A0B' : '#FFFFFF');
}

export function setThemePref(pref: ThemePref) {
  if (pref === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref);
  applyTheme(pref);
}

export function initTheme() {
  applyTheme();
  mq().addEventListener('change', () => applyTheme());
}
