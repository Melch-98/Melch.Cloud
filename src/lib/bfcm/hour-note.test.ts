import { describe, expect, it } from 'vitest';
import { normalizeHour, normalizeHourNote } from '@/lib/bfcm/hour-note';

describe('hour notes', () => {
  it('keeps a short note and rejects anything that is not text or is too long', () => {
    expect(normalizeHourNote('  checkout slow  ')).toEqual({ ok: true, note: 'checkout slow' });
    expect(normalizeHourNote('   ')).toEqual({ ok: true, note: '' });
    expect(normalizeHourNote(12).ok).toBe(false);
    expect(normalizeHourNote('x'.repeat(501)).ok).toBe(false);
  });

  it('accepts shop hours 0 through 23 only', () => {
    expect(normalizeHour(0)).toBe(0);
    expect(normalizeHour('23')).toBe(23);
    expect(normalizeHour(24)).toBeNull();
    expect(normalizeHour(-1)).toBeNull();
    expect(normalizeHour(1.5)).toBeNull();
  });
});
