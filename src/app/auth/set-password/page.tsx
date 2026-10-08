'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { parseSetPasswordLocation, type SetPasswordToken } from '@/lib/set-password-token';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

const exchangeInflight = new Map<string, Promise<{ ok: true } | { ok: false; message: string }>>();

export default function SetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<'working' | 'ready' | 'error' | 'done'>('working');
  const [message, setMessage] = useState('Checking your link…');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [requestEmail, setRequestEmail] = useState('');
  const [requestNote, setRequestNote] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    const token = parseSetPasswordLocation(window.location.search, window.location.hash);
    const key = exchangeKey(token);
    let cancelled = false;

    const run = exchangeInflight.get(key) || exchangeToken(token);
    exchangeInflight.set(key, run);
    run.then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPhase('ready');
        setMessage('Choose a password to finish signing in.');
        window.history.replaceState({}, '', '/auth/set-password');
      } else {
        setPhase('error');
        setMessage(result.message);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setMessage('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setMessage('Those passwords do not match.');
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setMessage('This app is not configured to set a password right now.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSaving(false);
      setMessage(error.message);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    let role = 'strategist';
    if (userId) {
      const { data: profile } = await supabase.from('users_profile').select('role').eq('id', userId).maybeSingle();
      if (profile?.role) role = profile.role;
    }

    setPhase('done');
    setMessage('Password saved. Taking you in…');
    setTimeout(() => {
      router.push(role === 'user' ? '/upload' : '/dashboard');
    }, 600);
  };

  const requestNewLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequesting(true);
    setRequestNote(null);
    try {
      const res = await fetch('/api/auth/request-set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: requestEmail.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      setRequestNote(
        data.message || 'If that email has an account, a new set-password link is on the way.'
      );
    } catch {
      setRequestNote('Could not request a new link. Try again in a minute.');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div
      className="relative min-h-screen flex items-center justify-center overflow-hidden px-4"
      style={{
        backgroundColor: '#0a0a0a',
        backgroundImage:
          'radial-gradient(circle at 20% 50%, rgba(200,184,154,0.05) 0%, transparent 50%)',
      }}
    >
      <div
        className="w-full max-w-md p-10 rounded-xl backdrop-blur border"
        style={{
          backgroundColor: 'rgba(13,13,13,0.5)',
          borderColor: 'rgba(255,255,255,0.1)',
        }}
      >
        <div className="mb-6 text-center">
          <h1 className="text-4xl font-bold mb-2">
            <span style={{ color: '#F5F5F8' }}>melch</span>
            <span style={{ color: '#C8B89A' }}>.cloud</span>
          </h1>
          <p className="text-xs" style={{ color: '#ABABAB' }}>
            Set your password
          </p>
        </div>

        {phase === 'working' && (
          <p className="text-sm text-center" style={{ color: '#ABABAB' }}>
            {message}
          </p>
        )}

        {phase === 'error' && (
          <div className="space-y-5">
            <div
              className="p-4 rounded-xl flex items-start gap-3 border"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#EF4444' }} />
              <p className="text-sm" style={{ color: '#EF4444' }}>
                {message}
              </p>
            </div>
            <form onSubmit={requestNewLink} className="space-y-3">
              <label className="block text-sm" style={{ color: '#ABABAB' }}>
                Email for a new link
              </label>
              <input
                type="email"
                required
                value={requestEmail}
                onChange={(e) => setRequestEmail(e.target.value)}
                placeholder="you@brand.com"
                className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#F5F5F8',
                }}
              />
              <button
                type="submit"
                disabled={requesting}
                className="w-full px-4 py-3 rounded-lg text-sm font-bold"
                style={{ backgroundColor: '#C8B89A', color: '#0A0A0A', opacity: requesting ? 0.6 : 1 }}
              >
                {requesting ? 'Sending…' : 'Email me a new link'}
              </button>
              {requestNote && (
                <p className="text-xs" style={{ color: '#ABABAB' }}>
                  {requestNote}
                </p>
              )}
            </form>
          </div>
        )}

        {(phase === 'ready' || phase === 'done') && (
          <form onSubmit={savePassword} className="space-y-4">
            {phase === 'done' ? (
              <div
                className="p-4 rounded-xl flex items-start gap-3 border"
                style={{ backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)' }}
              >
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#22C55E' }} />
                <p className="text-sm" style={{ color: '#22C55E' }}>
                  {message}
                </p>
              </div>
            ) : (
              message !== 'Choose a password to finish signing in.' && (
                <p className="text-sm" style={{ color: '#EF4444' }}>
                  {message}
                </p>
              )
            )}
            <div>
              <label className="block text-sm mb-2" style={{ color: '#ABABAB' }}>
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                disabled={saving || phase === 'done'}
                className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#F5F5F8',
                }}
              />
            </div>
            <div>
              <label className="block text-sm mb-2" style={{ color: '#ABABAB' }}>
                Confirm password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={saving || phase === 'done'}
                className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#F5F5F8',
                }}
              />
            </div>
            <button
              type="submit"
              disabled={saving || phase === 'done'}
              className="w-full px-4 py-3 rounded-lg text-sm font-bold"
              style={{ backgroundColor: '#C8B89A', color: '#0A0A0A', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : 'Save password and continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function exchangeKey(token: SetPasswordToken): string {
  if (token.status === 'otp') return `otp:${token.otpType}:${token.tokenHash}`;
  if (token.status === 'code') return `code:${token.code}`;
  if (token.status === 'implicit') return `implicit:${token.accessToken}`;
  if (token.status === 'error') return `error:${token.message}`;
  return 'missing';
}

async function exchangeToken(token: SetPasswordToken): Promise<{ ok: true } | { ok: false; message: string }> {
  if (token.status === 'error') return { ok: false, message: token.message };
  if (token.status === 'missing') {
    const supabase = createClient();
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session) return { ok: true };
    }
    return {
      ok: false,
      message: 'This link is missing its sign-in token. Request a new one below.',
    };
  }

  const supabase = createClient();
  if (!supabase) {
    return { ok: false, message: 'This app is not configured to accept invite links right now.' };
  }

  if (token.status === 'otp') {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: token.tokenHash,
      type: token.otpType,
    });
    if (error) return { ok: false, message: friendlyAuthError(error.message) };
    return { ok: true };
  }

  if (token.status === 'code') {
    const { error } = await supabase.auth.exchangeCodeForSession(token.code);
    if (error) return { ok: false, message: friendlyAuthError(error.message) };
    return { ok: true };
  }

  const { error } = await supabase.auth.setSession({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
  });
  if (error) return { ok: false, message: friendlyAuthError(error.message) };
  return { ok: true };
}

function friendlyAuthError(message: string): string {
  if (/expir/i.test(message)) return 'This link has expired. Request a new one below.';
  if (/invalid|not found/i.test(message)) return 'This link is not valid. Request a new one below.';
  return message;
}
