import { describe, expect, it } from 'vitest';
import {
  isUsageEndDateAllowed,
  localToday,
  showsUsageEndDate,
  usageEndDateError,
} from '@/lib/usage-end-date';

describe('usage end date', () => {
  it('shows the picker for whitelist or a creator', () => {
    expect(showsUsageEndDate({ isWhitelist: true, creatorName: '', creatorHandle: '' })).toBe(true);
    expect(showsUsageEndDate({ isWhitelist: false, creatorName: 'Jane', creatorHandle: '' })).toBe(true);
    expect(showsUsageEndDate({ isWhitelist: false, creatorName: '', creatorHandle: '@jane' })).toBe(true);
    expect(showsUsageEndDate({ isWhitelist: false, creatorName: '  ', creatorHandle: '' })).toBe(false);
  });

  it('requires today or later and allows a blank date', () => {
    expect(usageEndDateError('', '2026-10-10')).toBeNull();
    expect(usageEndDateError('2026-10-10', '2026-10-10')).toBeNull();
    expect(usageEndDateError('2026-10-11', '2026-10-10')).toBeNull();
    expect(usageEndDateError('2026-10-09', '2026-10-10')).toBe('Usage end date must be today or later');
    expect(usageEndDateError('yesterday', '2026-10-10')).toBe('Usage end date must be a date');
  });

  it('uses the browser calendar day as today', () => {
    const now = new Date(2026, 9, 10, 23, 30);
    expect(localToday(now)).toBe('2026-10-10');
    expect(isUsageEndDateAllowed('2026-10-09', new Date('2026-10-10T03:00:00Z'))).toBe(true);
    expect(isUsageEndDateAllowed('2026-10-08', new Date('2026-10-10T03:00:00Z'))).toBe(false);
  });
});
