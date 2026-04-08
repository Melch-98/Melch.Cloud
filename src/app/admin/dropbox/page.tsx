import { createServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function DropboxAdminPage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from('integrations')
    .select('service, account_email, updated_at, refresh_token')
    .eq('service', 'dropbox')
    .maybeSingle();

  const isConnected = !!row?.refresh_token;

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Dropbox integration</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Creative submissions land in the connected Dropbox account. Blip pulls from these folders.
      </p>

      {searchParams.connected && (
        <div style={{ background: '#e6ffed', border: '1px solid #b7eb8f', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          Dropbox connected successfully.
        </div>
      )}
      {searchParams.error && (
        <div style={{ background: '#fff1f0', border: '1px solid #ffa39e', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          Error: {searchParams.error}
        </div>
      )}

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 20 }}>
        <div style={{ marginBottom: 12 }}>
          <strong>Status:</strong>{' '}
          {isConnected ? (
            <span style={{ color: '#237804' }}>Connected</span>
          ) : (
            <span style={{ color: '#a8071a' }}>Not connected</span>
          )}
        </div>
        {isConnected && row?.account_email && (
          <div style={{ marginBottom: 12 }}>
            <strong>Account:</strong> {row.account_email}
          </div>
        )}
        {isConnected && row?.updated_at && (
          <div style={{ marginBottom: 16, color: '#666', fontSize: 13 }}>
            Last refreshed {new Date(row.updated_at).toLocaleString()}
          </div>
        )}
        <a
          href="/api/auth/dropbox/start"
          style={{
            display: 'inline-block',
            background: '#0061ff',
            color: 'white',
            padding: '10px 20px',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {isConnected ? 'Reconnect Dropbox' : 'Connect Dropbox'}
        </a>
      </div>

      <h2 style={{ fontSize: 18, marginTop: 32, marginBottom: 8 }}>Setup checklist</h2>
      <ol style={{ color: '#444', lineHeight: 1.7 }}>
        <li>Create a Dropbox app at <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer">dropbox.com/developers/apps</a> (scoped access, app folder).</li>
        <li>Permissions: <code>files.content.write</code>, <code>files.content.read</code>, <code>sharing.write</code>, <code>account_info.read</code>.</li>
        <li>OAuth2 redirect URI: <code>{`${process.env.NEXT_PUBLIC_SITE_URL || ''}/api/auth/dropbox/callback`}</code></li>
        <li>Set <code>DROPBOX_APP_KEY</code> and <code>DROPBOX_APP_SECRET</code> in Vercel env vars.</li>
        <li>Click <strong>Connect Dropbox</strong> above and approve.</li>
      </ol>
    </div>
  );
}
