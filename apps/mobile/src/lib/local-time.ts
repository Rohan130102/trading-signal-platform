/**
 * Times typed on the phone, which has no date picker here. Written and read in the phone's own time zone.
 */

/** "2026-11-12 19:22" in this phone's time zone, as an ISO instant. Null when it is not a real time. */
export function parseLocalTime(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  const real =
    date.getFullYear() === y &&
    date.getMonth() === mo - 1 &&
    date.getDate() === d &&
    date.getHours() === h &&
    date.getMinutes() === mi;
  return real ? date.toISOString() : null;
}

/** The same form, for showing a recorded time in this phone's time zone. */
export function localTimeText(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
