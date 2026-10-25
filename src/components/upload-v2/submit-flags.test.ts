import { describe, expect, it } from 'vitest';
import { weekFolderLabel, weekFolderStorageLabel } from '@/components/upload-v2/model';
import { SUBMIT_WRITES_WEEK_FOLDER, weekFolderInsert } from '@/components/upload-v2/submit-flags';

describe('week folder', () => {
  it('stores the ISO week-year with the week number', () => {
    const october = new Date(2026, 9, 25);
    expect(weekFolderLabel(october)).toBe('Week 43');
    expect(weekFolderStorageLabel(october)).toBe('2026/Week 43');
    expect(weekFolderStorageLabel(new Date(2025, 11, 29))).toBe('2026/Week 1');
    expect(weekFolderStorageLabel(new Date(2025, 11, 28))).toBe('2025/Week 52');
  });

  it('omits week_folder until the migration flag is turned on', () => {
    const uploadedAt = new Date(2026, 9, 25);
    expect(SUBMIT_WRITES_WEEK_FOLDER).toBe(false);
    expect(weekFolderInsert(uploadedAt)).toEqual({});
    expect(weekFolderInsert(uploadedAt, true)).toEqual({ week_folder: '2026/Week 43' });
  });
});
