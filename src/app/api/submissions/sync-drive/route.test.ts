import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authenticateRequest, createServiceClient } = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ authenticateRequest }));
vi.mock('@/lib/supabase-server', () => ({
  createServiceClient,
  getSignedStorageUrl: vi.fn(),
}));
vi.mock('@/lib/dropbox', () => ({
  ensureDropboxFolder: vi.fn(),
  saveUrlToDropbox: vi.fn(),
  checkSaveUrlJob: vi.fn(),
  getDropboxFolderLink: vi.fn(),
  sanitizeDropboxPathSegment: (value: string) => value,
  fileAwaitingDropboxCopy: () => false,
  DropboxNotConnectedError: class DropboxNotConnectedError extends Error {},
}));
vi.mock('@/lib/creative-upload-notify', () => ({
  notifySubmissionNamed: vi.fn(),
}));

import { POST } from '@/app/api/submissions/sync-drive/route';

function request(body?: string, authorization?: string) {
  return new NextRequest('http://localhost/api/submissions/sync-drive', {
    method: 'POST',
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body,
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret';
  authenticateRequest.mockReset();
  createServiceClient.mockReset();
  authenticateRequest.mockResolvedValue({ auth: null, error: 'Unauthorized', status: 401 });
});

describe('POST /api/submissions/sync-drive', () => {
  it('returns 401 before it reads the body or the submission', async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('returns 401 for an unauthenticated request that names a submission', async () => {
    const response = await POST(request(JSON.stringify({ submission_id: 'sub-1' })));
    expect(response.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('returns 400 when a signed-in caller omits submission_id', async () => {
    authenticateRequest.mockResolvedValue({
      auth: {
        user_id: 'user-1',
        email: 'a@melch.cloud',
        role: 'founder',
        brand_id: 'brand-1',
        permissions: {
          can_upload: true,
          can_view_pipeline: true,
          can_download: true,
          can_delete: false,
          is_active: true,
        },
      },
    });
    const response = await POST(request(JSON.stringify({})));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'submission_id required' });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('lets the cron secret past auth and then requires submission_id', async () => {
    const response = await POST(request(JSON.stringify({}), 'Bearer cron-secret'));
    expect(response.status).toBe(400);
    expect(authenticateRequest).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
