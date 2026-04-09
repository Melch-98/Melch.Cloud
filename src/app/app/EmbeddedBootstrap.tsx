'use client';

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    shopify?: {
      idToken: () => Promise<string>;
    };
  }
}

/**
 * Runs inside the Shopify admin iframe. Waits for App Bridge to expose
 * window.shopify, fetches a session token, and hands it to our backend
 * for the token-exchange grant.
 */
export default function EmbeddedBootstrap({ shop, host }: { shop: string; host: string }) {
  const [status, setStatus] = useState<'loading' | 'exchanging' | 'done' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function waitForAppBridge(timeoutMs = 8000): Promise<void> {
      const start = Date.now();
      while (!window.shopify?.idToken) {
        if (Date.now() - start > timeoutMs) throw new Error('App Bridge failed to load');
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    async function run() {
      try {
        if (!shop) throw new Error('Missing shop parameter');
        await waitForAppBridge();
        if (cancelled) return;

        const idToken = await window.shopify!.idToken();
        setStatus('exchanging');

        const res = await fetch('/api/shopify/token-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop, id_token: idToken }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Token exchange failed (${res.status}): ${body.slice(0, 200)}`);
        }

        setStatus('done');

        // Break out of the Shopify iframe to the main Melch.Cloud dashboard.
        const dashboardUrl = 'https://melch.cloud/analytics/daily-pnl';
        if (window.top && window.top !== window.self) {
          window.top.location.href = dashboardUrl;
        } else {
          window.location.href = dashboardUrl;
        }
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [shop, host]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 8 }}>Melch.Cloud</h1>
        {status === 'loading' && <p style={{ fontSize: 13, opacity: 0.7 }}>Connecting to your store…</p>}
        {status === 'exchanging' && <p style={{ fontSize: 13, opacity: 0.7 }}>Finishing install…</p>}
        {status === 'done' && <p style={{ fontSize: 13, opacity: 0.7 }}>Redirecting to your dashboard…</p>}
        {status === 'error' && (
          <>
            <p style={{ fontSize: 13, color: '#ef4444' }}>Install failed.</p>
            <p style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>{errorMessage}</p>
          </>
        )}
      </div>
    </div>
  );
}
