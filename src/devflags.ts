/**
 * Developer mode: on in the dev server, or anywhere (a deployed build too) with `?dev=1` in the
 * URL. `?dev=1` is remembered in this browser until `?dev=0`.
 */
const KEY = 'breachpoint.dev';

export function devEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    const q = new URLSearchParams(location.search).get('dev');
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** All chapters open (set by the developer panel). */
export const devState = { unlockAll: false };
