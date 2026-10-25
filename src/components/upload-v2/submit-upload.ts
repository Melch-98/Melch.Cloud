import { mapV2Submission, v2SubmitBlocker } from '@/components/upload-v2/map-submission';
import { weekFolderInsert } from '@/components/upload-v2/submit-flags';
import type { Creative, CreativeType } from '@/components/upload-v2/model';

type InsertResult = {
  data: { id?: string; usage_end_date?: string | null } | null;
  error: { message: string } | null;
};

/**
 * The browser Supabase client, narrowed to the calls the live upload form makes.
 * Inserts run under the signed-in user, which is the same RLS path as /upload.
 */
export type V2SubmitClient = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token: string } | null } }>;
    getUser: () => Promise<{ data: { user: { id: string } | null } }>;
  };
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        options: { upsert: boolean },
      ) => Promise<{ data: { path: string } | null; error: { message: string } | null }>;
    };
  };
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: () => { single: () => Promise<InsertResult> };
    } & PromiseLike<{ error: { message: string } | null }>;
  };
};

export type SubmitV2Input = {
  brandId: string;
  creatorName: string;
  creativeType: CreativeType;
  batchOn: boolean;
  creative: Creative;
  batchCreatives: readonly Creative[];
  today: string;
};

export type SubmitV2Result =
  | { ok: true; submissionId: string; fileCount: number; batchName: string }
  | { ok: false; error: string };

export async function submitUploadV2(
  deps: {
    supabase: V2SubmitClient;
    fetch: typeof fetch;
    now?: Date;
    onProgress?: (message: string) => void;
  },
  input: SubmitV2Input,
): Promise<SubmitV2Result> {
  const blocker = v2SubmitBlocker(input);
  if (blocker) return { ok: false, error: blocker };

  const { data: { session } } = await deps.supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: 'You need to be signed in' };

  deps.onProgress?.('Assigning a batch name…');
  let batchName: string;
  try {
    const res = await deps.fetch('/api/batch-name', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brand_id: input.brandId, reserved: [] }),
    });
    if (!res.ok) return { ok: false, error: 'Could not assign a batch name' };
    const json = await res.json() as { batch_name?: unknown };
    if (typeof json.batch_name !== 'string' || !json.batch_name) {
      return { ok: false, error: 'Could not assign a batch name' };
    }
    batchName = json.batch_name;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not assign a batch name' };
  }

  const mapped = mapV2Submission({
    brandId: input.brandId,
    userId: '',
    batchName,
    creatorName: input.creatorName,
    creativeType: input.creativeType,
    batchOn: input.batchOn,
    creative: input.creative,
    batchCreatives: input.batchCreatives,
  });
  if (mapped.files.length < 1) return { ok: false, error: 'Add at least one file' };

  const uploaded: { path: string }[] = [];
  try {
    for (let index = 0; index < mapped.files.length; index += 1) {
      const item = mapped.files[index];
      deps.onProgress?.(`Uploading file ${index + 1} of ${mapped.files.length}…`);
      const storagePath = `${input.brandId}/${batchName}/${item.row.file_name}`;
      const { data, error } = await deps.supabase.storage
        .from('creatives')
        .upload(storagePath, item.file, { upsert: true });
      if (error || !data?.path) {
        return {
          ok: false,
          error: `File upload failed for "${item.row.file_name}": ${error?.message || 'unknown error'}`,
        };
      }
      uploaded.push({ path: data.path });
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'File upload failed' };
  }

  const { data: { user } } = await deps.supabase.auth.getUser();
  if (!user?.id) return { ok: false, error: 'You need to be signed in' };

  deps.onProgress?.('Saving…');
  const submissionRow: Record<string, unknown> = {
    ...mapped.submission,
    user_id: user.id,
    ...weekFolderInsert(deps.now ?? new Date()),
  };

  const { data: submission, error: submissionError } = await deps.supabase
    .from('submissions')
    .insert(submissionRow)
    .select()
    .single();
  if (submissionError || !submission?.id) {
    return {
      ok: false,
      error: `Submission insert failed: ${submissionError?.message || 'unknown error'}`,
    };
  }

  for (let index = 0; index < mapped.files.length; index += 1) {
    const item = mapped.files[index];
    const fileRow = {
      submission_id: submission.id,
      file_name: item.row.file_name,
      file_type: item.row.file_type,
      file_size: item.row.file_size,
      file_url: uploaded[index].path,
      media_format: item.row.media_format,
      aspect_ratio: item.row.aspect_ratio,
      width: item.row.width,
      height: item.row.height,
      copy_headline: item.row.copy_headline,
      copy_body: item.row.copy_body,
      product_id: item.row.product_id,
      product_name: item.row.product_name,
      hook_angle: item.row.hook_angle,
      original_file_name: item.row.original_file_name,
    };
    const { error: fileError } = await deps.supabase.from('submission_files').insert(fileRow);
    if (fileError) {
      return {
        ok: false,
        error: `File record insert failed for "${item.row.file_name}": ${fileError.message}`,
      };
    }
  }

  const { data: { session: syncSession } } = await deps.supabase.auth.getSession();
  const syncHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (syncSession?.access_token) syncHeaders.Authorization = `Bearer ${syncSession.access_token}`;
  const syncOnce = (notify: boolean) => deps.fetch('/api/submissions/sync-drive', {
    method: 'POST',
    headers: syncHeaders,
    body: JSON.stringify({ submission_id: submission.id, notify }),
  });
  void syncOnce(true)
    .then(async (res) => {
      if (res.ok) return;
      const result = await res.json().catch(() => null) as { retryable?: boolean } | null;
      if (result?.retryable) await syncOnce(false);
    })
    .catch((error) => {
      console.warn('Dropbox sync trigger failed (non-fatal):', error);
    });
  if (submission.usage_end_date) {
    void deps.fetch('/api/submissions/usage-task', {
      method: 'POST',
      headers: syncHeaders,
      body: JSON.stringify({ submission_id: submission.id }),
    }).catch((error) => {
      console.warn('Usage task trigger failed (non-fatal):', error);
    });
  }

  return {
    ok: true,
    submissionId: submission.id,
    fileCount: mapped.files.length,
    batchName,
  };
}
