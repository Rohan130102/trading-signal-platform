import { localTimeText, parseLocalTime } from '../src/lib/local-time';

describe('typed times', () => {
  it('reads a local time and shows it back the same way', () => {
    const iso = parseLocalTime('2026-11-12 19:22');
    expect(iso).not.toBeNull();
    expect(localTimeText(iso as string)).toBe('2026-11-12 19:22');
    expect(parseLocalTime(' 2026-11-12T07:05 ')).toBe(new Date(2026, 10, 12, 7, 5).toISOString());
  });

  it('refuses times that do not exist or are typed another way', () => {
    for (const text of [
      '2026-02-30 10:00',
      '2026-11-12 24:00',
      '2026-11-12 10:60',
      '12/11/2026 10:00',
      '2026-11-12',
      '',
    ]) {
      expect(parseLocalTime(text)).toBeNull();
    }
  });
});
