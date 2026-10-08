import { describe, expect, it } from 'vitest';
import type { AutoTagProvider } from '@/lib/auto-tag/provider';
import { tagPendingSubmissionFiles, tagSyncBudgetMs } from '@/lib/creative-tag-sync';

type Row = Record<string, unknown>;

function cloneRow(row: Row): Row {
  return JSON.parse(JSON.stringify(row)) as Row;
}

interface Filter {
  kind: 'eq' | 'is' | 'in';
  column: string;
  value: unknown;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const value = row[filter.column];
    if (filter.kind === 'eq') return value === filter.value;
    if (filter.kind === 'is') return filter.value === null ? value == null : value === filter.value;
    const list = filter.value as unknown[];
    return list.includes(value);
  });
}

function memorySupabase(seed: { files: Row[]; submissions: Row[]; brands: Row[]; products: Row[] }) {
  const tables: Record<string, Row[]> = {
    submission_files: seed.files.map(cloneRow),
    submissions: seed.submissions.map(cloneRow),
    brands: seed.brands.map(cloneRow),
    shopify_products: seed.products.map(cloneRow),
  };

  function from(table: string) {
    const filters: Filter[] = [];
    let patch: Row | null = null;
    const api = {
      update(next: Row) {
        patch = cloneRow(next);
        return api;
      },
      select() {
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push({ kind: 'eq', column, value });
        return api;
      },
      is(column: string, value: unknown) {
        filters.push({ kind: 'is', column, value });
        return api;
      },
      in(column: string, value: unknown) {
        filters.push({ kind: 'in', column, value });
        return api;
      },
      single() {
        return api.exec(true);
      },
      then(
        resolve: (value: { data: unknown; error: { message: string } | null }) => unknown,
        reject?: (err: unknown) => unknown
      ) {
        return api.exec(false).then(resolve, reject);
      },
      async exec(one: boolean) {
        const rows = tables[table] || [];
        const matched = rows.filter((row) => matches(row, filters));
        if (patch) {
          const next = cloneRow(patch);
          matched.forEach((row) => {
            Object.assign(row, next);
          });
        }
        const data = matched.map(cloneRow);
        if (one) {
          return { data: data[0] ?? null, error: data[0] ? null : { message: 'not found' } };
        }
        return { data, error: null };
      },
    };
    return api;
  }

  return {
    from,
    storage: {
      from() {
        return { download: async () => ({ data: null, error: { message: 'missing' } }) };
      },
    },
    files: tables.submission_files,
  };
}

function pngDataUrl(width: number, height: number): string {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[16] = (width >>> 24) & 255;
  bytes[17] = (width >>> 16) & 255;
  bytes[18] = (width >>> 8) & 255;
  bytes[19] = width & 255;
  bytes[20] = (height >>> 24) & 255;
  bytes[21] = (height >>> 16) & 255;
  bytes[22] = (height >>> 8) & 255;
  bytes[23] = height & 255;
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

const frame = pngDataUrl(32, 16);

function fileRow(id: string, name: string, extra: Row = {}): Row {
  return {
    id,
    submission_id: 'sub-1',
    file_name: name,
    original_file_name: name,
    file_url: `${id}.mp4`,
    file_type: 'video/mp4',
    media_format: 'VIDEO',
    aspect_ratio: null,
    creative_type: null,
    fidelity: null,
    product_id: null,
    product_name: null,
    hook_angle: null,
    landing_page_url: null,
    creator_name: null,
    dropbox_path: null,
    dropbox_job_id: null,
    auto_tags: { frames: [frame], duration_seconds: 15 },
    tag_source: 'pending',
    ...extra,
  };
}

const brand = {
  id: 'brand-1',
  name: 'Tallow Twins Co',
  slug: 'tallow-twins',
  website_url: 'https://shop.example',
  shopify_store_domain: null,
  file_naming_pattern: null,
};

const submission = { id: 'sub-1', brand_id: 'brand-1' };

describe('tagSyncBudgetMs', () => {
  it('caps the cron at 45s and keeps 60s for the rest of the run', () => {
    expect(tagSyncBudgetMs(undefined, 1_000)).toBe(45_000);
    expect(tagSyncBudgetMs(200_000, 1_000)).toBe(45_000);
    expect(tagSyncBudgetMs(70_000, 0)).toBe(10_000);
    expect(tagSyncBudgetMs(30_000, 0)).toBe(0);
  });
});

describe('tagPendingSubmissionFiles', () => {
  it('returns inside the budget and leaves no claimed row pending or tagging', async () => {
    const files = [
      fileRow('a', 'a.mp4'),
      fileRow('b', 'b.mp4'),
      fileRow('c', 'c.mp4'),
      fileRow('d', 'd.mp4'),
      fileRow('e', 'e.mp4'),
      fileRow('f', 'f.mp4'),
      fileRow('copied', 'copied.mp4', { dropbox_path: '/Brand/Batch/copied.mp4' }),
    ];
    const db = memorySupabase({ files, submissions: [submission], brands: [brand], products: [] });
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const shared = new Set<string>();
    const provider: AutoTagProvider = {
      id: 'slow',
      isConfigured: () => true,
      async tag(input) {
        calls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        shared.add(input.sharedPrompt);
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 60_000);
            const onAbort = () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            };
            if (input.signal?.aborted) onAbort();
            else input.signal?.addEventListener('abort', onAbort, { once: true });
          });
        } finally {
          inFlight -= 1;
        }
        return {
          raw: {},
          model: 'slow',
          usage: { costInUsdTicks: null, promptTokens: null, completionTokens: null },
        };
      },
    };

    const budgetMs = 800;
    const started = Date.now();
    await tagPendingSubmissionFiles(db, 'sub-1', { budgetMs, provider });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(budgetMs + 1_000);
    expect(calls).toBeLessThanOrEqual(4);
    expect(calls).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(shared.size).toBe(1);

    const eligible = db.files.filter((row) => row.id !== 'copied');
    eligible.forEach((row) => {
      expect(row.tag_source).toBe('failed');
      expect(row.tag_source).not.toBe('pending');
      expect(row.tag_source).not.toBe('tagging');
      expect((row.auto_tags as { error?: string; frames?: unknown }).error).toBe('time_budget');
      expect((row.auto_tags as { frames?: unknown }).frames).toBeUndefined();
      expect(row.file_name).toBe(`${row.id}.mp4`);
    });

    const copied = db.files.find((row) => row.id === 'copied');
    expect(copied?.tag_source).toBe('pending');
    expect(copied?.file_name).toBe('copied.mp4');
    expect((copied?.auto_tags as { frames?: unknown[] }).frames).toHaveLength(1);
  }, 5_000);

  it('does not claim rows when the budget is already gone or vision is off', async () => {
    const files = [fileRow('a', 'a.mp4')];
    const db = memorySupabase({ files, submissions: [submission], brands: [brand], products: [] });
    let calls = 0;
    const provider: AutoTagProvider = {
      id: 'slow',
      isConfigured: () => true,
      async tag() {
        calls += 1;
        return {
          raw: {},
          model: 'slow',
          usage: { costInUsdTicks: null, promptTokens: null, completionTokens: null },
        };
      },
    };
    await tagPendingSubmissionFiles(db, 'sub-1', { budgetMs: 0, provider });
    expect(calls).toBe(0);
    expect(db.files[0].tag_source).toBe('pending');

    const off = memorySupabase({
      files: [fileRow('a', 'a.mp4')],
      submissions: [submission],
      brands: [brand],
      products: [],
    });
    await tagPendingSubmissionFiles(off, 'sub-1', {
      provider: { id: 'off', isConfigured: () => false, tag: provider.tag },
    });
    expect(off.files[0].tag_source).toBe('pending');
  });

  it('saves tags as each call finishes, then de-dupes the batch names', async () => {
    const files = [fileRow('a', 'IMG_1.mp4'), fileRow('b', 'IMG_2.mp4')];
    const db = memorySupabase({ files, submissions: [submission], brands: [brand], products: [] });
    const seenShared: string[] = [];
    const seenFiles: string[] = [];
    const provider: AutoTagProvider = {
      id: 'fast',
      isConfigured: () => true,
      async tag(input) {
        seenShared.push(input.sharedPrompt);
        seenFiles.push(input.filePrompt);
        expect(input.sharedPrompt.includes('File name:')).toBe(false);
        expect(input.filePrompt.startsWith('File name:')).toBe(true);
        return {
          raw: {
            creative_type: 'grwm',
            creative_type_confidence: 0.95,
            product_id: null,
            product_confidence: 0,
            hook_angle: 'Tired skin at night',
            hook_angle_confidence: 0.9,
          },
          model: 'fake',
          usage: { costInUsdTicks: 100, promptTokens: 2, completionTokens: 1 },
        };
      },
    };

    await tagPendingSubmissionFiles(db, 'sub-1', { budgetMs: 5_000, provider });

    expect(seenShared[0]).toBe(seenShared[1]);
    expect(seenFiles.join('\n')).toContain('IMG_1.mp4');
    expect(seenFiles.join('\n')).toContain('IMG_2.mp4');
    const names = db.files.map((row) => row.file_name).sort();
    expect(names).toEqual([
      'TallowTwins_TiredSkinAtNight_GRWM_15s.mp4',
      'TallowTwins_TiredSkinAtNight_GRWM_15s_v2.mp4',
    ]);
    db.files.forEach((row) => {
      expect(row.tag_source).toBe('fallback');
      expect(row.creative_type).toBe('grwm');
      expect(row.fidelity).toBe('lofi');
      expect((row.auto_tags as { frames?: unknown }).frames).toBeUndefined();
      expect(row.tag_source).not.toBe('pending');
      expect(row.tag_source).not.toBe('tagging');
    });
  });
});
