'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Building2,
  FolderOpen,
  Users,
  BarChart3,
  ShoppingBag,
  Globe,
  Plus,
  ArrowLeft,
  Archive,
  RotateCcw,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface Brand {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  meta_ad_account_id: string | null;
  google_ads_customer_id: string | null;
  shopify_store_domain: string | null;
  shopify_gross_margin_pct: number | null;
  dropbox_folder_path: string | null;
  archived_at: string | null;
  created_at: string;
}

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  brand_id: string | null;
}

type Step = 'brand' | 'integrations' | 'dropbox' | 'users' | 'review';

const STEPS: { key: Step; label: string; icon: React.ElementType }[] = [
  { key: 'brand', label: 'Brand Details', icon: Building2 },
  { key: 'integrations', label: 'Ad Accounts', icon: BarChart3 },
  { key: 'dropbox', label: 'Dropbox Folder', icon: FolderOpen },
  { key: 'users', label: 'Team Members', icon: Users },
  { key: 'review', label: 'Review & Launch', icon: CheckCircle2 },
];

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const card: React.CSSProperties = {
  background: '#111',
  border: '1px solid #222',
  borderRadius: 12,
  padding: 24,
};
const inputStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 8,
  color: '#fff',
  padding: '10px 14px',
  fontSize: 14,
  width: '100%',
  outline: 'none',
};
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  marginBottom: 6,
  display: 'block',
  fontWeight: 500,
};
const btnPrimary: React.CSSProperties = {
  background: '#C8B89A',
  color: '#000',
  border: 'none',
  borderRadius: 8,
  padding: '10px 24px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: 'transparent',
  color: '#888',
  border: '1px solid #333',
  borderRadius: 8,
  padding: '10px 24px',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */
export default function OnboardPage() {
  const router = useRouter();
  const supabase = createClient();

  /* Auth */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  /* Wizard state */
  const [step, setStep] = useState<Step>('brand');
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'new' | 'manage'>('new');

  /* Existing brands (for manage view) */
  const [brands, setBrands] = useState<Brand[]>([]);
  const [archivedBrands, setArchivedBrands] = useState<Brand[]>([]);

  /* Brand form */
  const [brandName, setBrandName] = useState('');
  const [brandSlug, setBrandSlug] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [grossMargin, setGrossMargin] = useState('62');

  /* Integration form */
  const [metaAdAccountId, setMetaAdAccountId] = useState('');
  const [googleAdsCustomerId, setGoogleAdsCustomerId] = useState('');
  const [shopifyDomain, setShopifyDomain] = useState('');

  /* Dropbox */
  const [dropboxPath, setDropboxPath] = useState('');

  /* Users */
  const [newUsers, setNewUsers] = useState<{ email: string; fullName: string; role: string }[]>([
    { email: '', fullName: '', role: 'strategist' },
  ]);

  /* Created brand ID (after step 1) */
  const [createdBrandId, setCreatedBrandId] = useState<string | null>(null);

  /* ---------------------------------------------------------------- */
  /*  Auth + load brands                                               */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (!profile || !['admin', 'founder'].includes(profile.role)) {
        router.push('/dashboard');
        return;
      }
      setUserRole(profile.role);

      // Load active + archived brands
      const { data: active } = await supabase
        .from('brands')
        .select('*')
        .is('archived_at', null)
        .order('name');
      setBrands(active || []);

      const { data: archived } = await supabase
        .from('brands')
        .select('*')
        .not('archived_at', 'is', null)
        .order('name');
      setArchivedBrands(archived || []);

      setLoading(false);
    })();
  }, []);

  /* Auto-generate slug from name */
  useEffect(() => {
    if (brandName && !createdBrandId) {
      setBrandSlug(slugify(brandName));
      setDropboxPath(`/${brandName}`);
    }
  }, [brandName, createdBrandId]);

  /* ---------------------------------------------------------------- */
  /*  Step handlers                                                    */
  /* ---------------------------------------------------------------- */
  const handleCreateBrand = useCallback(async () => {
    if (!brandName.trim()) { setError('Brand name is required'); return; }
    setSaving(true);
    setError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    // Insert brand directly with service role via API
    const res = await fetch('/api/admin/onboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: 'create_brand',
        name: brandName.trim(),
        slug: brandSlug || slugify(brandName),
        website_url: websiteUrl || null,
        shopify_gross_margin_pct: Number(grossMargin) || 62,
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      setError(result.error || 'Failed to create brand');
      setSaving(false);
      return;
    }

    setCreatedBrandId(result.brand.id);
    setSaving(false);
    setStep('integrations');
  }, [brandName, brandSlug, websiteUrl, grossMargin]);

  const handleSaveIntegrations = useCallback(async () => {
    if (!createdBrandId) return;
    setSaving(true);
    setError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    const res = await fetch('/api/admin/onboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: 'set_integrations',
        brand_id: createdBrandId,
        meta_ad_account_id: metaAdAccountId || null,
        google_ads_customer_id: googleAdsCustomerId || null,
        shopify_store_domain: shopifyDomain || null,
      }),
    });

    if (!res.ok) {
      const result = await res.json();
      setError(result.error || 'Failed to save integrations');
    }
    setSaving(false);
    setStep('dropbox');
  }, [createdBrandId, metaAdAccountId, googleAdsCustomerId, shopifyDomain]);

  const handleSaveDropbox = useCallback(async () => {
    if (!createdBrandId) return;
    setSaving(true);
    setError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    const res = await fetch('/api/admin/onboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: 'set_dropbox',
        brand_id: createdBrandId,
        dropbox_folder_path: dropboxPath || `/${brandName}`,
      }),
    });

    if (!res.ok) {
      const result = await res.json();
      setError(result.error || 'Failed to set Dropbox folder');
    }
    setSaving(false);
    setStep('users');
  }, [createdBrandId, dropboxPath, brandName]);

  const handleInviteUsers = useCallback(async () => {
    if (!createdBrandId) return;
    const validUsers = newUsers.filter((u) => u.email.trim());
    if (validUsers.length === 0) {
      setStep('review');
      return;
    }
    setSaving(true);
    setError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    const res = await fetch('/api/admin/onboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: 'create_users',
        brand_id: createdBrandId,
        users: validUsers.map((u) => ({
          email: u.email.trim().toLowerCase(),
          full_name: u.fullName.trim() || u.email.split('@')[0],
          role: u.role,
        })),
      }),
    });

    if (!res.ok) {
      const result = await res.json();
      setError(result.error || 'Failed to create users');
    }
    setSaving(false);
    setStep('review');
  }, [createdBrandId, newUsers]);

  const handleArchive = useCallback(
    async (brandId: string) => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      await fetch('/api/admin/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'archive_brand', brand_id: brandId }),
      });
      // Refresh
      const b = brands.find((x) => x.id === brandId);
      if (b) {
        setBrands((prev) => prev.filter((x) => x.id !== brandId));
        setArchivedBrands((prev) => [...prev, { ...b, archived_at: new Date().toISOString() }]);
      }
    },
    [brands]
  );

  const handleRestore = useCallback(
    async (brandId: string) => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      await fetch('/api/admin/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'restore_brand', brand_id: brandId }),
      });
      const b = archivedBrands.find((x) => x.id === brandId);
      if (b) {
        setArchivedBrands((prev) => prev.filter((x) => x.id !== brandId));
        setBrands((prev) => [...prev, { ...b, archived_at: null }].sort((a, c) => a.name.localeCompare(c.name)));
      }
    },
    [archivedBrands]
  );

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                   */
  /* ---------------------------------------------------------------- */
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const completionChecks = {
    brand: !!createdBrandId,
    integrations: !!(metaAdAccountId || googleAdsCustomerId || shopifyDomain),
    dropbox: !!dropboxPath,
    users: newUsers.some((u) => u.email.trim()),
    review: false,
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader className="animate-spin" size={24} color="#C8B89A" />
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Manage view — list all brands with archive/restore              */
  /* ---------------------------------------------------------------- */
  if (mode === 'manage') {
    return (
      <Navbar>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <button onClick={() => setMode('new')} style={{ ...btnSecondary, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ArrowLeft size={14} /> New Client
            </button>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>Manage Clients</h1>
          </div>

          {/* Active brands */}
          <div style={{ ...card, marginBottom: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#C8B89A', marginBottom: 16 }}>
              Active ({brands.length})
            </h2>
            {brands.length === 0 && <p style={{ color: '#666', fontSize: 13 }}>No active brands.</p>}
            {brands.map((b) => (
              <div
                key={b.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 0',
                  borderBottom: '1px solid #1a1a1a',
                }}
              >
                <div>
                  <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                  <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>
                    {[
                      b.meta_ad_account_id && 'Meta',
                      b.google_ads_customer_id && 'Google',
                      b.shopify_store_domain && 'Shopify',
                      b.dropbox_folder_path && 'Dropbox',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No integrations'}
                  </div>
                </div>
                <button
                  onClick={() => handleArchive(b.id)}
                  style={{
                    ...btnSecondary,
                    padding: '6px 14px',
                    fontSize: 12,
                    color: '#EF4444',
                    borderColor: 'rgba(239,68,68,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Archive size={12} /> Archive
                </button>
              </div>
            ))}
          </div>

          {/* Archived brands */}
          {archivedBrands.length > 0 && (
            <div style={{ ...card }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: '#666', marginBottom: 16 }}>
                Archived ({archivedBrands.length})
              </h2>
              {archivedBrands.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 0',
                    borderBottom: '1px solid #1a1a1a',
                    opacity: 0.6,
                  }}
                >
                  <div>
                    <div style={{ color: '#888', fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                    <div style={{ color: '#555', fontSize: 12, marginTop: 2 }}>
                      Archived {b.archived_at ? new Date(b.archived_at).toLocaleDateString() : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(b.id)}
                    style={{
                      ...btnSecondary,
                      padding: '6px 14px',
                      fontSize: 12,
                      color: '#22C55E',
                      borderColor: 'rgba(34,197,94,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <RotateCcw size={12} /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Navbar>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  New client wizard                                                */
  /* ---------------------------------------------------------------- */
  return (
    <Navbar>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>Onboard New Client</h1>
          <button onClick={() => setMode('manage')} style={{ ...btnSecondary, padding: '8px 16px', fontSize: 12 }}>
            Manage Clients
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 32 }}>
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = s.key === step;
            const isDone = completionChecks[s.key];
            return (
              <button
                key={s.key}
                onClick={() => {
                  if (i <= stepIndex || isDone || (i === stepIndex + 1 && completionChecks[STEPS[stepIndex].key])) {
                    setStep(s.key);
                  }
                }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '10px 8px',
                  borderRadius: 8,
                  border: isActive ? '1px solid #C8B89A' : '1px solid #222',
                  background: isActive ? 'rgba(200,184,154,0.08)' : isDone ? 'rgba(34,197,94,0.06)' : '#111',
                  color: isActive ? '#C8B89A' : isDone ? '#22C55E' : '#666',
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {isDone ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                <span style={{ display: 'none' }}>{s.label}</span>
                {/* Show label on wider screens */}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#EF4444',
              fontSize: 13,
            }}
          >
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* ---------------------------------------------------------- */}
        {/*  Step 1: Brand Details                                      */}
        {/* ---------------------------------------------------------- */}
        {step === 'brand' && (
          <div style={card}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 20 }}>Brand Details</h2>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Brand Name *</label>
              <input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="e.g. Tallow Twins"
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Slug</label>
              <input
                value={brandSlug}
                onChange={(e) => setBrandSlug(e.target.value)}
                placeholder="auto-generated"
                style={{ ...inputStyle, color: '#888' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Website URL</label>
              <input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://example.com"
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Gross Margin %</label>
              <input
                type="number"
                value={grossMargin}
                onChange={(e) => setGrossMargin(e.target.value)}
                placeholder="62"
                style={{ ...inputStyle, width: 120 }}
              />
            </div>

            <button onClick={handleCreateBrand} disabled={saving} style={btnPrimary}>
              {saving ? 'Creating...' : 'Create Brand'}
              {!saving && <ChevronRight size={14} style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
            </button>
          </div>
        )}

        {/* ---------------------------------------------------------- */}
        {/*  Step 2: Ad Account Integrations                            */}
        {/* ---------------------------------------------------------- */}
        {step === 'integrations' && (
          <div style={card}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 4 }}>Ad Account Integrations</h2>
            <p style={{ color: '#666', fontSize: 13, marginBottom: 20 }}>Connect ad platforms. You can skip and add these later.</p>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Meta Ad Account ID</label>
              <input
                value={metaAdAccountId}
                onChange={(e) => setMetaAdAccountId(e.target.value)}
                placeholder="act_123456789"
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Google Ads Customer ID</label>
              <input
                value={googleAdsCustomerId}
                onChange={(e) => setGoogleAdsCustomerId(e.target.value)}
                placeholder="123-456-7890"
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Shopify Store Domain</label>
              <input
                value={shopifyDomain}
                onChange={(e) => setShopifyDomain(e.target.value)}
                placeholder="store-name.myshopify.com"
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep('brand')} style={btnSecondary}>Back</button>
              <button onClick={handleSaveIntegrations} disabled={saving} style={btnPrimary}>
                {saving ? 'Saving...' : 'Next'}
                {!saving && <ChevronRight size={14} style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
              </button>
              <button onClick={() => setStep('dropbox')} style={{ ...btnSecondary, marginLeft: 'auto' }}>
                Skip
              </button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------- */}
        {/*  Step 3: Dropbox Folder                                     */}
        {/* ---------------------------------------------------------- */}
        {step === 'dropbox' && (
          <div style={card}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 4 }}>Dropbox Folder</h2>
            <p style={{ color: '#666', fontSize: 13, marginBottom: 20 }}>
              Set the Dropbox folder path for creative file sync. This is relative to your app folder (/Apps/Melch.Cloud).
            </p>

            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Folder Path</label>
              <input
                value={dropboxPath}
                onChange={(e) => setDropboxPath(e.target.value)}
                placeholder={`/${brandName || 'Brand Name'}`}
                style={inputStyle}
              />
              <p style={{ color: '#555', fontSize: 11, marginTop: 6 }}>
                The folder will be auto-created in Dropbox when the first creative is uploaded.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep('integrations')} style={btnSecondary}>Back</button>
              <button onClick={handleSaveDropbox} disabled={saving} style={btnPrimary}>
                {saving ? 'Saving...' : 'Next'}
                {!saving && <ChevronRight size={14} style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
              </button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------- */}
        {/*  Step 4: Team Members                                       */}
        {/* ---------------------------------------------------------- */}
        {step === 'users' && (
          <div style={card}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 4 }}>Team Members</h2>
            <p style={{ color: '#666', fontSize: 13, marginBottom: 20 }}>
              Add client team members who need access. You can skip and invite later.
            </p>

            {newUsers.map((u, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 2 }}>
                  {i === 0 && <label style={labelStyle}>Email</label>}
                  <input
                    value={u.email}
                    onChange={(e) => {
                      const copy = [...newUsers];
                      copy[i] = { ...copy[i], email: e.target.value };
                      setNewUsers(copy);
                    }}
                    placeholder="team@client.com"
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1.5 }}>
                  {i === 0 && <label style={labelStyle}>Name</label>}
                  <input
                    value={u.fullName}
                    onChange={(e) => {
                      const copy = [...newUsers];
                      copy[i] = { ...copy[i], fullName: e.target.value };
                      setNewUsers(copy);
                    }}
                    placeholder="Full name"
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  {i === 0 && <label style={labelStyle}>Role</label>}
                  <select
                    value={u.role}
                    onChange={(e) => {
                      const copy = [...newUsers];
                      copy[i] = { ...copy[i], role: e.target.value };
                      setNewUsers(copy);
                    }}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    <option value="strategist">Strategist</option>
                    <option value="founder">Founder</option>
                  </select>
                </div>
              </div>
            ))}

            <button
              onClick={() => setNewUsers((prev) => [...prev, { email: '', fullName: '', role: 'strategist' }])}
              style={{ ...btnSecondary, padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24 }}
            >
              <Plus size={12} /> Add another
            </button>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep('dropbox')} style={btnSecondary}>Back</button>
              <button onClick={handleInviteUsers} disabled={saving} style={btnPrimary}>
                {saving ? 'Creating...' : 'Next'}
                {!saving && <ChevronRight size={14} style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
              </button>
              <button onClick={() => setStep('review')} style={{ ...btnSecondary, marginLeft: 'auto' }}>
                Skip
              </button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------- */}
        {/*  Step 5: Review                                             */}
        {/* ---------------------------------------------------------- */}
        {step === 'review' && (
          <div style={card}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 20 }}>Review & Launch</h2>

            <div style={{ display: 'grid', gap: 12 }}>
              <ReviewRow
                label="Brand"
                value={brandName}
                done={!!createdBrandId}
                onEdit={() => setStep('brand')}
              />
              <ReviewRow
                label="Ad Accounts"
                value={
                  [metaAdAccountId && 'Meta', googleAdsCustomerId && 'Google Ads', shopifyDomain && 'Shopify']
                    .filter(Boolean)
                    .join(', ') || 'None configured'
                }
                done={!!(metaAdAccountId || googleAdsCustomerId || shopifyDomain)}
                onEdit={() => setStep('integrations')}
              />
              <ReviewRow
                label="Dropbox"
                value={dropboxPath || 'Not set'}
                done={!!dropboxPath}
                onEdit={() => setStep('dropbox')}
              />
              <ReviewRow
                label="Team"
                value={
                  newUsers.filter((u) => u.email.trim()).length > 0
                    ? `${newUsers.filter((u) => u.email.trim()).length} member(s)`
                    : 'No members added'
                }
                done={newUsers.some((u) => u.email.trim())}
                onEdit={() => setStep('users')}
              />
            </div>

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button onClick={() => setStep('users')} style={btnSecondary}>Back</button>
              <button
                onClick={() => router.push('/admin')}
                style={btnPrimary}
              >
                Go to Creative Queue
                <ChevronRight size={14} style={{ marginLeft: 6, verticalAlign: 'middle' }} />
              </button>
            </div>
          </div>
        )}
      </div>
    </Navbar>
  );
}

/* ------------------------------------------------------------------ */
/*  Review row                                                         */
/* ------------------------------------------------------------------ */
function ReviewRow({
  label,
  value,
  done,
  onEdit,
}: {
  label: string;
  value: string;
  done: boolean;
  onEdit: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderRadius: 8,
        background: done ? 'rgba(34,197,94,0.04)' : 'rgba(200,184,154,0.04)',
        border: done ? '1px solid rgba(34,197,94,0.15)' : '1px solid #222',
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 14, color: done ? '#fff' : '#666' }}>{value}</div>
      </div>
      <button
        onClick={onEdit}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#C8B89A',
          fontSize: 12,
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        Edit
      </button>
    </div>
  );
}
