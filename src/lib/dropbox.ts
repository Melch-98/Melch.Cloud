/**
 * Dropbox client using OAuth2 refresh tokens. Files uploaded through here
 * are owned by the connected Dropbox account (google@melch.media on Plus 2TB).
 *
 * App folder mode: all paths are relative to /Apps/Melch.Cloud automatically.
 * Everything here talks HTTP directly — no SDK, no deps.
 */
import { createServiceClient } from './supabase-server';

const DBX_AUTH = 'https://api.dropboxapi.com/2';
const DBX_CONTENT = 'https://content.dropboxapi.com/2';
const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
const SIMPLE_UPLOAD_LIMIT = 150 * 1024 * 1024; // 150MB

export class DropboxNotConnectedError extends Error {
  constructor() {
    super('Dropbox is not connected. Connect it from the admin panel.');
    this.name = 'DropboxNotConnectedError';
  }
}

/**
 * Return a valid access token, refreshing if needed.
 * Caches in the integrations row keyed by service='dropbox'.
 */
export async function getDropboxAccessToken(): Promise<string> {
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from('integrations')
    .select('refresh_token, access_token, access_token_expires_at')
    .eq('service', 'dropbox')
    .maybeSingle();

  if (!row || !row.refresh_token) {
    throw new DropboxNotConnectedError();
  }

  // If cached token is still good for 2+ minutes, reuse it
  if (row.access_token && row.access_token_expires_at) {
    const expiresAt = new Date(row.access_token_expires_at).getTime();
    if (expiresAt - Date.now() > 2 * 60 * 1000) {
      return row.access_token;
    }
  }

  // Exchange refresh token for new access token
  const appKey = process.env.DROPBOX_APP_KEY!;
  const appSecret = process.env.DROPBOX_APP_SECRET!;
  if (!appKey || !appSecret) {
    throw new Error('DROPBOX_APP_KEY and DROPBOX_APP_SECRET must be set');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
  });
  const auth = Buffer.from(`${appKey}:${appSecret}`).toString('base64');

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox token refresh failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase
    .from('integrations')
    .update({
      access_token: data.access_token,
      access_token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('service', 'dropbox');

  return data.access_token;
}

async function dbxApi<T = any>(path: string, args: any, token: string): Promise<T> {
  const res = await fetch(`${DBX_AUTH}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Ensure a folder exists. Returns the resolved path. Idempotent.
 * In app folder mode, path should start with '/'.
 */
export async function ensureDropboxFolder(path: string): Promise<{ path: string }> {
  const token = await getDropboxAccessToken();
  try {
    await dbxApi('/files/create_folder_v2', { path, autorename: false }, token);
  } catch (err: any) {
    // folder may already exist — that's fine
    if (!String(err.message).includes('path/conflict/folder')) {
      // re-throw any non-"already exists" error
      if (!String(err.message).includes('conflict')) throw err;
    }
  }
  return { path };
}

/**
 * Upload a file. Uses simple upload for <=150MB, session upload otherwise.
 * Returns { path, id, size }.
 */
export async function uploadToDropbox(params: {
  path: string;
  buffer: Buffer;
  mode?: 'add' | 'overwrite';
}): Promise<{ path: string; id: string; size: number }> {
  const token = await getDropboxAccessToken();
  const mode = params.mode || 'add';

  if (params.buffer.length <= SIMPLE_UPLOAD_LIMIT) {
    const args = {
      path: params.path,
      mode,
      autorename: true,
      mute: true,
      strict_conflict: false,
    };
    const res = await fetch(`${DBX_CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify(args),
      },
      body: params.buffer,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dropbox upload failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as any;
    return { path: data.path_display, id: data.id, size: data.size };
  }

  // Chunked upload session
  let sessionId: string | null = null;
  let offset = 0;
  const total = params.buffer.length;

  // start
  {
    const chunk = params.buffer.subarray(0, Math.min(CHUNK_SIZE, total));
    const res = await fetch(`${DBX_CONTENT}/files/upload_session/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ close: false }),
      },
      body: chunk,
    });
    if (!res.ok) throw new Error(`upload_session/start failed: ${await res.text()}`);
    sessionId = ((await res.json()) as any).session_id;
    offset = chunk.length;
  }

  // append
  while (total - offset > CHUNK_SIZE) {
    const chunk = params.buffer.subarray(offset, offset + CHUNK_SIZE);
    const res = await fetch(`${DBX_CONTENT}/files/upload_session/append_v2`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          cursor: { session_id: sessionId, offset },
          close: false,
        }),
      },
      body: chunk,
    });
    if (!res.ok) throw new Error(`upload_session/append_v2 failed: ${await res.text()}`);
    offset += chunk.length;
  }

  // finish
  const finalChunk = params.buffer.subarray(offset);
  const res = await fetch(`${DBX_CONTENT}/files/upload_session/finish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        cursor: { session_id: sessionId, offset },
        commit: { path: params.path, mode, autorename: true, mute: true },
      }),
    },
    body: finalChunk,
  });
  if (!res.ok) throw new Error(`upload_session/finish failed: ${await res.text()}`);
  const data = (await res.json()) as any;
  return { path: data.path_display, id: data.id, size: data.size };
}

/**
 * Get a shareable link (preview URL) for a folder or file.
 */
export async function getDropboxFolderLink(path: string): Promise<string> {
  const token = await getDropboxAccessToken();
  // Try to create a shared link. If it already exists, fetch it.
  try {
    const res = await dbxApi<any>(
      '/sharing/create_shared_link_with_settings',
      { path, settings: { audience: 'public', access: 'viewer' } },
      token
    );
    return res.url;
  } catch (err: any) {
    // existing link — list it
    const list = await dbxApi<any>('/sharing/list_shared_links', { path, direct_only: true }, token);
    if (list.links && list.links.length > 0) return list.links[0].url;
    throw err;
  }
}

/**
 * OAuth PKCE URL builder. We store app key in env.
 */
export function buildDropboxAuthUrl(redirectUri: string, state: string): string {
  const appKey = process.env.DROPBOX_APP_KEY!;
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    redirect_uri: redirectUri,
    token_access_type: 'offline', // gets refresh token
    state,
  });
  return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeDropboxCode(
  code: string,
  redirectUri: string
): Promise<{ refresh_token: string; access_token: string; expires_in: number; account_id: string }> {
  const appKey = process.env.DROPBOX_APP_KEY!;
  const appSecret = process.env.DROPBOX_APP_SECRET!;
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const auth = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new Error(`OAuth exchange failed: ${await res.text()}`);
  return res.json() as any;
}

export async function getDropboxAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${DBX_AUTH}/users/get_current_account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return data.email || null;
  } catch {
    return null;
  }
}

/**
 * Sanitize a string for use in a Dropbox path segment.
 */
export function sanitizeDropboxPathSegment(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim();
}
