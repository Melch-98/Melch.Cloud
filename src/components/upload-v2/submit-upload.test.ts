import { describe, expect, it } from 'vitest';
import type { CarouselCard, Creative, FlexibleAsset, LocalMedia, UploadModes } from '@/components/upload-v2/model';
import { submitUploadV2, type V2SubmitClient } from '@/components/upload-v2/submit-upload';

type Call =
  | { op: 'getSession' }
  | { op: 'getUser' }
  | { op: 'fetch'; url: string; method: string; headers: Record<string, string>; body: unknown }
  | { op: 'storage.upload'; bucket: string; path: string; upsert: boolean; fileName: string; type: string; size: number }
  | { op: 'insert'; table: string; row: Record<string, unknown> };

function sourceFile(name: string, type: string, bytes = 1200): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function local(
  source: File,
  width: number,
  height: number,
  detected: LocalMedia['detectedAspectRatio'],
): LocalMedia {
  return {
    url: `blob:${source.name}`,
    kind: source.type.startsWith('video/') ? 'video' : 'image',
    name: source.name,
    bytes: source.size,
    width,
    height,
    file: source,
    mediaFormat: source.type.startsWith('video/') ? 'VIDEO' : 'STATIC',
    detectedAspectRatio: detected,
  };
}

function modes(partial: Partial<UploadModes> = {}): UploadModes {
  return { whitelist: false, carousel: false, flexible: false, ...partial };
}

function creative(partial: Partial<Creative> = {}): Creative {
  return {
    id: 'creative-1',
    name: 'Creative',
    originalName: 'file.jpg',
    caption: '',
    productKey: '',
    productLabel: '',
    angle: '',
    handle: '',
    usageEndDate: '',
    perpetual: false,
    ratio: '1:1',
    kicker: '',
    from: '#111',
    to: '#222',
    media: null,
    assets: [],
    cards: [],
    ...partial,
  };
}

function card(id: string, media: LocalMedia | null, headline = ''): CarouselCard {
  return { id, headline, kicker: '', from: '#111', to: '#222', media };
}

function asset(id: string, media: LocalMedia): FlexibleAsset {
  return { id, media };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function client(options?: {
  uploadError?: string;
  sync?: 'ok' | 'retryable' | 'throw';
}) {
  const calls: Call[] = [];
  let syncs = 0;
  const supabase = {
    auth: {
      async getSession() {
        calls.push({ op: 'getSession' });
        return { data: { session: { access_token: 'token-1' } } };
      },
      async getUser() {
        calls.push({ op: 'getUser' });
        return { data: { user: { id: 'user-1' } } };
      },
    },
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, file: File, uploadOptions: { upsert: boolean }) {
            calls.push({
              op: 'storage.upload',
              bucket,
              path,
              upsert: uploadOptions.upsert,
              fileName: file.name,
              type: file.type,
              size: file.size,
            });
            if (options?.uploadError) return { data: null, error: { message: options.uploadError } };
            return { data: { path }, error: null };
          },
        };
      },
    },
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ op: 'insert', table, row: { ...row } });
          const result = {
            data: table === 'submissions'
              ? { id: 'sub-1', usage_end_date: (row.usage_end_date ?? null) as string | null }
              : null,
            error: null as { message: string } | null,
          };
          const promise = Promise.resolve({ data: result.data, error: result.error });
          return Object.assign(promise, {
            select() {
              return { single: async () => result };
            },
          });
        },
      };
    },
  } as V2SubmitClient;

  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null;
    calls.push({
      op: 'fetch',
      url,
      method: init?.method ?? 'GET',
      headers: headerRecord(init?.headers),
      body,
    });
    if (url === '/api/batch-name') return jsonResponse({ batch_name: 'MNT_261025_0007' });
    if (url === '/api/submissions/sync-drive') {
      syncs += 1;
      if (options?.sync === 'throw') throw new Error('network down');
      if (options?.sync === 'retryable' && syncs === 1) {
        return jsonResponse({ retryable: true, error: 'temporary' }, 503);
      }
      return jsonResponse({ ok: true });
    }
    if (url === '/api/submissions/usage-task') return jsonResponse({ ok: true });
    return jsonResponse({ error: 'unexpected' }, 500);
  };

  return { calls, supabase, fetchMock };
}

const authHeaders = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer token-1',
};

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('submitUploadV2 sequence', () => {
  it('submits one whitelist creative with a usage date', async () => {
    const source = sourceFile('morning.mp4', 'video/mp4', 4000);
    const harness = client();
    const result = await submitUploadV2({
      supabase: harness.supabase,
      fetch: harness.fetchMock,
      now: new Date(2026, 9, 25),
    }, {
      brandId: 'brand-1',
      creatorName: '  Jane Doe  ',
      modes: modes({ whitelist: true }),
      today: '2026-10-25',
      plainCreatives: [creative({ media: local(source, 1080, 1920, '9x16') })],
      creative: creative({
        caption: '  Hold the frame  ',
        productKey: 'product:chicken-bone-broth',
        productLabel: 'Chicken Bone Broth',
        angle: 'Morning ritual',
        handle: ' @jane ',
        usageEndDate: '2026-12-31',
        ratio: '1:1',
      }),
    });

    expect(result).toEqual({
      ok: true,
      submissionId: 'sub-1',
      fileCount: 1,
      batchName: 'MNT_261025_0007',
    });
    const storedName = 'jane-doe_whitelist_chicken-bone-broth_morning-ritual.mp4';
    const storagePath = `brand-1/MNT_261025_0007/${storedName}`;
    expect(harness.calls).toEqual([
      { op: 'getSession' },
      {
        op: 'fetch',
        url: '/api/batch-name',
        method: 'POST',
        headers: authHeaders,
        body: { brand_id: 'brand-1', reserved: [] },
      },
      {
        op: 'storage.upload',
        bucket: 'creatives',
        path: storagePath,
        upsert: true,
        fileName: 'morning.mp4',
        type: 'video/mp4',
        size: 4000,
      },
      { op: 'getUser' },
      {
        op: 'insert',
        table: 'submissions',
        row: {
          brand_id: 'brand-1',
          user_id: 'user-1',
          drive_sync_status: 'pending',
          batch_name: 'MNT_261025_0007',
          creative_type: 'video',
          creator_name: 'Jane Doe',
          creator_social_handle: '@jane',
          landing_page_url: '',
          copy_title: '',
          copy_headline: null,
          copy_body: 'Hold the frame',
          copy_cta: null,
          notes: '',
          is_carousel: false,
          is_flexible: false,
          is_whitelist: true,
          usage_end_date: '2026-12-31',
          file_count: 1,
        },
      },
      {
        op: 'insert',
        table: 'submission_files',
        row: {
          submission_id: 'sub-1',
          file_name: storedName,
          file_type: 'video/mp4',
          file_size: 4000,
          file_url: storagePath,
          media_format: 'VIDEO',
          aspect_ratio: '9x16',
          width: 1080,
          height: 1920,
          copy_headline: null,
          copy_body: null,
          product_id: null,
          product_name: 'Chicken Bone Broth',
          hook_angle: 'Morning ritual',
          original_file_name: 'morning.mp4',
        },
      },
      { op: 'getSession' },
      {
        op: 'fetch',
        url: '/api/submissions/sync-drive',
        method: 'POST',
        headers: authHeaders,
        body: { submission_id: 'sub-1', notify: true },
      },
      {
        op: 'fetch',
        url: '/api/submissions/usage-task',
        method: 'POST',
        headers: authHeaders,
        body: { submission_id: 'sub-1' },
      },
    ]);
    expect(harness.calls.find((call) => call.op === 'insert' && call.table === 'submissions')).not.toHaveProperty('row.week_folder');
  });

  it('submits a carousel of 3 as one submission and skips the usage task', async () => {
    const files = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => sourceFile(name, 'image/jpeg'));
    const harness = client();
    const result = await submitUploadV2({ supabase: harness.supabase, fetch: harness.fetchMock }, {
      brandId: 'brand-1',
      creatorName: 'Jane',
      modes: modes({ carousel: true }),
      today: '2026-10-25',
      plainCreatives: [],
      creative: creative({
        productKey: 'product:serum',
        productLabel: 'Serum',
        angle: 'Morning',
        caption: 'Three cards',
        usageEndDate: '2026-12-31',
        cards: [
          card('1', local(files[0], 1080, 1350, '4x5'), 'Open'),
          card('2', local(files[1], 1080, 1920, '9x16'), 'Hold'),
          card('3', local(files[2], 1920, 1080, '16x9'), 'Close'),
        ],
      }),
    });

    expect(result).toMatchObject({ ok: true, fileCount: 3, batchName: 'MNT_261025_0007' });
    const names = [
      'jane_carousel_serum_morning.jpg',
      'jane_carousel_serum_morning-2.jpg',
      'jane_carousel_serum_morning-3.jpg',
    ];
    expect(harness.calls.map((call) => call.op === 'storage.upload' ? call.path : call.op === 'fetch' ? call.url : call.op === 'insert' ? call.table : call.op)).toEqual([
      'getSession',
      '/api/batch-name',
      `brand-1/MNT_261025_0007/${names[0]}`,
      `brand-1/MNT_261025_0007/${names[1]}`,
      `brand-1/MNT_261025_0007/${names[2]}`,
      'getUser',
      'submissions',
      'submission_files',
      'submission_files',
      'submission_files',
      'getSession',
      '/api/submissions/sync-drive',
    ]);
    const submission = harness.calls.find((call) => call.op === 'insert' && call.table === 'submissions');
    expect(submission && submission.op === 'insert' ? submission.row : null).toMatchObject({
      creative_type: 'carousel',
      creator_name: 'Jane',
      is_carousel: true,
      is_flexible: false,
      is_whitelist: false,
      usage_end_date: null,
      file_count: 3,
      copy_body: 'Three cards',
    });
    expect(submission && submission.op === 'insert' ? submission.row : {}).not.toHaveProperty('week_folder');
    const fileRows = harness.calls.filter((call) => call.op === 'insert' && call.table === 'submission_files');
    expect(fileRows.map((call) => call.op === 'insert' ? call.row.file_name : '')).toEqual(names);
    expect(fileRows.map((call) => call.op === 'insert' ? call.row.original_file_name : '')).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(fileRows.map((call) => call.op === 'insert' ? call.row.copy_headline : '')).toEqual(['Open', 'Hold', 'Close']);
    expect(fileRows.map((call) => call.op === 'insert' ? call.row.aspect_ratio : '')).toEqual(['4x5', '9x16', '16x9']);
    expect(harness.calls.some((call) => call.op === 'fetch' && call.url === '/api/submissions/usage-task')).toBe(false);
  });

  it('submits a flexible creative of 3 with the flexible flag winning over mixed files', async () => {
    const files = [
      sourceFile('one.jpg', 'image/jpeg'),
      sourceFile('two.mp4', 'video/mp4'),
      sourceFile('three.png', 'image/png'),
    ];
    const harness = client();
    const result = await submitUploadV2({ supabase: harness.supabase, fetch: harness.fetchMock }, {
      brandId: 'brand-1',
      creatorName: '',
      modes: modes({ flexible: true }),
      today: '2026-10-25',
      plainCreatives: [],
      creative: creative({
        assets: [
          asset('1', local(files[0], 1080, 1080, '1x1')),
          asset('2', local(files[1], 1080, 1920, '9x16')),
          asset('3', local(files[2], 1000, 1100, 'OTHER')),
        ],
      }),
    });
    expect(result).toMatchObject({ ok: true, fileCount: 3 });
    const submission = harness.calls.find((call) => call.op === 'insert' && call.table === 'submissions');
    expect(submission && submission.op === 'insert' ? submission.row : null).toMatchObject({
      creative_type: 'flexible',
      creator_name: '',
      is_carousel: false,
      is_flexible: true,
      is_whitelist: false,
      usage_end_date: null,
      file_count: 3,
    });
    const uploads = harness.calls.filter((call) => call.op === 'storage.upload');
    expect(uploads.map((call) => call.op === 'storage.upload' ? call.fileName : '')).toEqual(['one.jpg', 'two.mp4', 'three.png']);
    expect(uploads.map((call) => call.op === 'storage.upload' ? call.path : '')).toEqual([
      'brand-1/MNT_261025_0007/one.jpg',
      'brand-1/MNT_261025_0007/two.mp4',
      'brand-1/MNT_261025_0007/three.png',
    ]);
    const fileRows = harness.calls.filter((call) => call.op === 'insert' && call.table === 'submission_files');
    expect(fileRows.map((call) => call.op === 'insert' ? call.row.media_format : '')).toEqual(['STATIC', 'VIDEO', 'STATIC']);
    expect(harness.calls.some((call) => call.op === 'fetch' && call.url === '/api/submissions/usage-task')).toBe(false);
    const uploadIndex = harness.calls.findIndex((call) => call.op === 'storage.upload');
    const insertIndex = harness.calls.findIndex((call) => call.op === 'insert');
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(uploadIndex);
  });

  it('submits a batch of 4 with no creator as plain bulk files', async () => {
    const names = ['pour.jpg', 'shelf.jpg', 'square.jpg', 'grid.png'];
    const harness = client();
    const result = await submitUploadV2({ supabase: harness.supabase, fetch: harness.fetchMock }, {
      brandId: 'brand-1',
      creatorName: 'Jane Doe',
      modes: modes(),
      today: '2026-10-25',
      creative: creative({ usageEndDate: '2026-12-31', handle: '@jane' }),
      plainCreatives: names.map((name, index) => creative({
        id: `b-${index}`,
        productKey: 'product:ignored',
        productLabel: 'Ignored',
        angle: 'Ignored',
        handle: '@ignored',
        media: local(sourceFile(name, 'image/png'), 1080, 1350, '4x5'),
      })),
    });
    expect(result).toMatchObject({ ok: true, fileCount: 4 });
    const submission = harness.calls.find((call) => call.op === 'insert' && call.table === 'submissions');
    expect(submission && submission.op === 'insert' ? submission.row : null).toMatchObject({
      creative_type: 'static',
      creator_name: '',
      creator_social_handle: null,
      copy_body: '',
      is_carousel: false,
      is_flexible: false,
      is_whitelist: false,
      usage_end_date: null,
      file_count: 4,
    });
    const fileRows = harness.calls.filter((call) => call.op === 'insert' && call.table === 'submission_files');
    expect(fileRows.map((call) => call.op === 'insert' ? call.row.file_name : '')).toEqual(names);
    expect(fileRows.map((call) => call.op === 'insert' ? call.row.original_file_name : '')).toEqual(names);
    expect(fileRows.every((call) => call.op === 'insert' && call.row.product_name === null && call.row.hook_angle === null)).toBe(true);
    expect(harness.calls.some((call) => call.op === 'fetch' && call.url === '/api/submissions/usage-task')).toBe(false);
    expect(harness.calls.filter((call) => call.op === 'storage.upload')).toHaveLength(4);
    expect(harness.calls.filter((call) => call.op === 'insert' && call.table === 'submissions')).toHaveLength(1);
  });

  it('does not insert rows when storage upload fails', async () => {
    const harness = client({ uploadError: 'bucket missing' });
    const result = await submitUploadV2({ supabase: harness.supabase, fetch: harness.fetchMock }, {
      brandId: 'brand-1',
      creatorName: '',
      modes: modes({ whitelist: true }),
      today: '2026-10-25',
      plainCreatives: [creative({ media: local(sourceFile('a.jpg', 'image/jpeg'), 1080, 1080, '1x1') })],
      creative: creative(),
    });
    expect(result).toEqual({ ok: false, error: 'File upload failed for "a.jpg": bucket missing' });
    expect(harness.calls.some((call) => call.op === 'insert')).toBe(false);
  });

  it('retries sync-drive once without notify when the first response is retryable', async () => {
    const harness = client({ sync: 'retryable' });
    const result = await submitUploadV2({ supabase: harness.supabase, fetch: harness.fetchMock }, {
      brandId: 'brand-1',
      creatorName: '',
      modes: modes({ whitelist: true }),
      today: '2026-10-25',
      plainCreatives: [creative({ media: local(sourceFile('a.jpg', 'image/jpeg'), 1080, 1080, '1x1') })],
      creative: creative(),
    });
    expect(result.ok).toBe(true);
    await settle();
    const syncs = harness.calls.filter((call) => call.op === 'fetch' && call.url === '/api/submissions/sync-drive');
    expect(syncs.map((call) => call.op === 'fetch' ? call.body : null)).toEqual([
      { submission_id: 'sub-1', notify: true },
      { submission_id: 'sub-1', notify: false },
    ]);
  });

  it('still succeeds when the sync trigger throws', async () => {
    const harness = client({ sync: 'throw' });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const result = await submitUploadV2({ supabase: harness.supabase, fetch: harness.fetchMock }, {
        brandId: 'brand-1',
        creatorName: '',
        modes: modes({ whitelist: true }),
        today: '2026-10-25',
        plainCreatives: [creative({ media: local(sourceFile('a.jpg', 'image/jpeg'), 1080, 1080, '1x1') })],
        creative: creative({
          usageEndDate: '2026-12-31',
        }),
      });
      expect(result).toMatchObject({ ok: true, fileCount: 1 });
      await settle();
    } finally {
      console.warn = warn;
    }
  });
});
