export type ThemeChoice = 'dark' | 'light' | 'system';

const KEY = 'sd-theme';

/** Runs before paint through an inline script, so there is no flash of the wrong theme. */
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem('${KEY}')||'dark';var t=c==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):c;document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()`;

export function getTheme(): ThemeChoice {
  try {
    return (localStorage.getItem(KEY) as ThemeChoice | null) ?? 'dark';
  } catch {
    return 'dark';
  }
}

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // The choice just will not persist, for example in a private window.
  }
  const resolved =
    choice === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : choice;
  document.documentElement.setAttribute('data-theme', resolved);
}
