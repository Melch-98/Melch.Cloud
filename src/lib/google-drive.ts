import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';

/**
 * Google Drive client + helpers for syncing creative batches from Supabase Storage → Drive.
 *
 * Auth: service account JSON pasted into GOOGLE_SERVICE_ACCOUNT_JSON env var.
 * Each brand's parent Drive folder must be shared with the service account email
 * as Editor before sync will work.
 */

let cachedClient: drive_v3.Drive | null = null;

export function getDriveClient(): drive_v3.Drive {
  if (cachedClient) return cachedClient;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var not set');
  }

  let credentials: { client_email: string; private_key: string };
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  cachedClient = google.drive({ version: 'v3', auth });
  return cachedClient;
}

/**
 * Create a child folder inside the given parent folder.
 * Returns { id, url } of the new folder.
 */
export async function createDriveFolder(
  parentFolderId: string,
  name: string
): Promise<{ id: string; url: string }> {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  const id = res.data.id;
  if (!id) throw new Error('Drive folder creation returned no ID');

  return {
    id,
    url: res.data.webViewLink || `https://drive.google.com/drive/folders/${id}`,
  };
}

/**
 * Upload a file buffer to a Drive folder.
 */
export async function uploadFileToDrive(params: {
  folderId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ id: string }> {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name: params.fileName,
      parents: [params.folderId],
    },
    media: {
      mimeType: params.mimeType || 'application/octet-stream',
      body: Readable.from(params.buffer),
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  if (!res.data.id) throw new Error('Drive upload returned no file ID');
  return { id: res.data.id };
}
