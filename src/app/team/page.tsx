'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Shield,
  Users,
  Plus,
  Trash2,
  X,
  UserPlus,
  Settings2,
  Globe,
  Copy,
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

/* ─── Types ──────────────────────────────────────────────────── */

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'strategist' | 'founder';
  brand_id: string | null;
  permissions: {
    can_upload: boolean;
    can_view_pipeline: boolean;
    can_download: boolean;
    can_delete: boolean;
    is_active: boolean;
  };
}

interface Brand {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  meta_ad_account_id: string | null;
  google_ads_customer_id: string | null;
  shopify_store_domain: string | null;
  shopify_client_id: string | null;
  shopify_client_secret: string | null;
  shopify_gross_margin_pct: number | null;
}

/* ─── Small Components ───────────────────────────────────────── */

function Toast({ message, visible }: { message: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="fixed bottom-6 right-6 px-4 py-3 rounded-lg flex items-center gap-2 text-sm font-medium z-50"
      style={{
        backgroundColor: 'rgba(76,175,80,0.15)',
        color: '#4CAF50',
        border: '1px solid rgba(76,175,80,0.3)',
      }}
    >
      <Check className="w-4 h-4" />
      {message}
    </div>
  );
}

function UserInitial({ email, role }: { email: string; role: string }) {
  const initial = email.charAt(0).toUpperCase();
  const bg = role === 'admin' ? '#C8B89A' : role === 'founder' ? '#34A853' : '#5B8DEE';
  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-bold text-xs"
      style={{
        backgroundColor: bg,
        color: role === 'admin' ? '#0A0A0A' : '#F5F5F8',
      }}
    >
      {initial}
    </div>
  );
}

function PermissionToggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      className="flex items-center gap-2 group"
      disabled={disabled}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <div
        className="w-4 h-4 rounded border flex items-center justify-center transition-all"
        style={{
          borderColor: checked ? '#C8B89A' : 'rgba(255,255,255,0.15)',
          backgroundColor: checked ? 'rgba(200,184,154,0.15)' : 'transparent',
        }}
      >
        {checked && <Check className="w-2.5 h-2.5 text-[#C8B89A]" />}
      </div>
      <span className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors">
        {label}
      </span>
    </button>
  );
}

/* ─── Team Member Row ────────────────────────────────────────── */

function MemberRow({
  user,
  onUpdatePermission,
  onUpdateRole,
  onRemoveFromTeam,
  saving,
}: {
  user: UserProfile;
  onUpdatePermission: (userId: string, field: string, value: boolean) => void;
  onUpdateRole: (userId: string, role: 'admin' | 'strategist' | 'founder') => void;
  onRemoveFromTeam: (userId: string) => void;
  saving: boolean;
}) {
  const [showRoleMenu, setShowRoleMenu] = useState(false);

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-lg group transition-all hover:bg-white/[0.02]"
    >
      <UserInitial email={user.email} role={user.role} />

      {/* Name + email */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#F5F5F8] truncate">
          {user.full_name || user.email.split('@')[0]}
        </p>
        <p className="text-xs text-gray-500 truncate">{user.email}</p>
      </div>

      {/* Permissions */}
      <div className="hidden md:flex items-center gap-4">
        <PermissionToggle
          label="Upload"
          checked={user.permissions.can_upload}
          onChange={(v) => onUpdatePermission(user.id, 'can_upload', v)}
          disabled={saving}
        />
        <PermissionToggle
          label="Pipeline"
          checked={user.permissions.can_view_pipeline}
          onChange={(v) => onUpdatePermission(user.id, 'can_view_pipeline', v)}
          disabled={saving}
        />
        <PermissionToggle
          label="Download"
          checked={user.permissions.can_download}
          onChange={(v) => onUpdatePermission(user.id, 'can_download', v)}
          disabled={saving}
        />
        <PermissionToggle
          label="Delete"
          checked={user.permissions.can_delete}
          onChange={(v) => onUpdatePermission(user.id, 'can_delete', v)}
          disabled={saving}
        />
      </div>

      {/* Role badge */}
      <div className="relative">
        <button
          onClick={() => setShowRoleMenu(!showRoleMenu)}
          className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all"
          style={{
            backgroundColor:
              user.role === 'admin'
                ? 'rgba(200,184,154,0.15)'
                : user.role === 'founder'
                ? 'rgba(52,168,83,0.15)'
                : 'rgba(91,141,238,0.15)',
            color: user.role === 'admin' ? '#C8B89A' : user.role === 'founder' ? '#34A853' : '#5B8DEE',
          }}
        >
          {user.role}
        </button>
        {showRoleMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowRoleMenu(false)} />
            <div
              className="absolute top-full right-0 mt-1 rounded-lg overflow-hidden shadow-lg z-20"
              style={{
                backgroundColor: '#1A1A1A',
                border: '1px solid rgba(255,255,255,0.1)',
                minWidth: '130px',
              }}
            >
              {(['admin', 'strategist', 'founder'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    onUpdateRole(user.id, r);
                    setShowRoleMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/[0.05]"
                  style={{ color: user.role === r ? '#C8B89A' : '#888' }}
                >
                  {r === 'admin' ? 'Admin' : r === 'founder' ? 'Founder' : 'Strategist'}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Remove from team */}
      <button
        onClick={() => onRemoveFromTeam(user.id)}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all hover:bg-red-500/10"
        style={{ color: '#666' }}
        title="Remove from team"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ─── Team Card ──────────────────────────────────────────────── */

function TeamCard({
  brand,
  members,
  allUsers,
  onUpdatePermission,
  onUpdateRole,
  onAddMember,
  onRemoveMember,
  onUpdateBrand,
  saving,
}: {
  brand: Brand;
  members: UserProfile[];
  allUsers: UserProfile[];
  onUpdatePermission: (userId: string, field: string, value: boolean) => void;
  onUpdateRole: (userId: string, role: 'admin' | 'strategist') => void;
  onAddMember: (userId: string, brandId: string) => void;
  onRemoveMember: (userId: string) => void;
  onUpdateBrand: (brandId: string, field: string, value: string) => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [adAccountValue, setAdAccountValue] = useState(brand.meta_ad_account_id || '');
  const [googleAdsValue, setGoogleAdsValue] = useState(brand.google_ads_customer_id || '');
  const [websiteValue, setWebsiteValue] = useState(brand.website_url || '');
  const [shopifyDomain, setShopifyDomain] = useState(brand.shopify_store_domain || '');
  const [shopifyClientId, setShopifyClientId] = useState(brand.shopify_client_id || '');
  const [shopifyClientSecret, setShopifyClientSecret] = useState(brand.shopify_client_secret || '');
  const [shopifyMargin, setShopifyMargin] = useState(String(brand.shopify_gross_margin_pct ?? '62'));
  const [showShopifySecret, setShowShopifySecret] = useState(false);

  const unassignedUsers = allUsers.filter(
    (u) => !u.brand_id && u.role !== 'admin'
  );

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Team header */}
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        style={{ borderBottom: expanded ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
      >
        {expanded ? (
          <ChevronDown size={16} className="text-gray-500" />
        ) : (
          <ChevronRight size={16} className="text-gray-500" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[#F5F5F8]">{brand.name}</h3>
            <span className="text-[10px] text-gray-500 font-medium">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </span>
          </div>
          {brand.website_url && (
            <p className="text-[11px] text-gray-500 truncate">{brand.website_url}</p>
          )}
        </div>

        {/* Ad account badges */}
        {brand.meta_ad_account_id && (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded hidden sm:inline"
            style={{
              backgroundColor: 'rgba(24,119,242,0.1)',
              color: '#5B9CF5',
            }}
          >
            Meta
          </span>
        )}
        {brand.google_ads_customer_id && (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded hidden sm:inline"
            style={{
              backgroundColor: 'rgba(52,168,83,0.1)',
              color: '#34A853',
            }}
          >
            Google
          </span>
        )}
        {brand.shopify_store_domain && (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded hidden sm:inline"
            style={{
              backgroundColor: 'rgba(150,191,72,0.1)',
              color: '#96BF48',
            }}
          >
            Shopify
          </span>
        )}

        {/* Settings gear */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowSettings(!showSettings);
          }}
          className="p-1.5 rounded-lg transition-all hover:bg-white/[0.05]"
          style={{ color: '#555' }}
        >
          <Settings2 size={14} />
        </button>

        {/* Add member */}
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="p-1.5 rounded-lg transition-all hover:bg-white/[0.05]"
            style={{ color: '#C8B89A' }}
            title="Add member"
          >
            <UserPlus size={14} />
          </button>

          {showAddMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
              <div
                className="absolute top-full right-0 mt-1 rounded-lg overflow-hidden shadow-lg z-20"
                style={{
                  backgroundColor: '#1A1A1A',
                  border: '1px solid rgba(255,255,255,0.1)',
                  minWidth: '220px',
                }}
              >
                {unassignedUsers.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-gray-500">No unassigned users</p>
                ) : (
                  unassignedUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        onAddMember(u.id, brand.id);
                        setShowAddMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-xs transition-colors hover:bg-white/[0.05] flex items-center gap-2"
                      style={{ color: '#aaa' }}
                    >
                      <UserInitial email={u.email} role={u.role} />
                      <div>
                        <p className="text-[#F5F5F8]">{u.full_name || u.email.split('@')[0]}</p>
                        <p className="text-gray-500">{u.email}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div
          className="px-5 py-4 space-y-3"
          onClick={(e) => e.stopPropagation()}
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', backgroundColor: 'rgba(255,255,255,0.01)' }}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                Website URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={websiteValue}
                  onChange={(e) => setWebsiteValue(e.target.value)}
                  placeholder="https://example.com"
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#F5F5F8',
                  }}
                />
                <button
                  onClick={() => onUpdateBrand(brand.id, 'website_url', websiteValue)}
                  className="px-2 py-1 rounded-lg"
                  style={{ backgroundColor: 'rgba(200,184,154,0.15)', color: '#C8B89A' }}
                >
                  <Check size={12} />
                </button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                Meta Ad Account ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={adAccountValue}
                  onChange={(e) => setAdAccountValue(e.target.value)}
                  placeholder="act_123456789"
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#F5F5F8',
                  }}
                />
                <button
                  onClick={() => onUpdateBrand(brand.id, 'meta_ad_account_id', adAccountValue)}
                  className="px-2 py-1 rounded-lg"
                  style={{ backgroundColor: 'rgba(200,184,154,0.15)', color: '#C8B89A' }}
                >
                  <Check size={12} />
                </button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                Google Ads Customer ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={googleAdsValue}
                  onChange={(e) => setGoogleAdsValue(e.target.value)}
                  placeholder="1234567890"
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#F5F5F8',
                  }}
                />
                <button
                  onClick={() => onUpdateBrand(brand.id, 'google_ads_customer_id', googleAdsValue)}
                  className="px-2 py-1 rounded-lg"
                  style={{ backgroundColor: 'rgba(52,168,83,0.15)', color: '#34A853' }}
                >
                  <Check size={12} />
                </button>
              </div>
            </div>
          </div>

          {/* Shopify section */}
          <div className="pt-3 mt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2.5" style={{ color: '#96BF48' }}>
              Shopify Connection
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                  Store Domain
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shopifyDomain}
                    onChange={(e) => setShopifyDomain(e.target.value)}
                    placeholder="mystore.myshopify.com"
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#F5F5F8',
                    }}
                  />
                  <button
                    onClick={() => onUpdateBrand(brand.id, 'shopify_store_domain', shopifyDomain)}
                    className="px-2 py-1 rounded-lg"
                    style={{ backgroundColor: 'rgba(150,191,72,0.15)', color: '#96BF48' }}
                  >
                    <Check size={12} />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                  Client ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shopifyClientId}
                    onChange={(e) => setShopifyClientId(e.target.value)}
                    placeholder="Shopify app Client ID"
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#F5F5F8',
                    }}
                  />
                  <button
                    onClick={() => onUpdateBrand(brand.id, 'shopify_client_id', shopifyClientId)}
                    className="px-2 py-1 rounded-lg"
                    style={{ backgroundColor: 'rgba(150,191,72,0.15)', color: '#96BF48' }}
                  >
                    <Check size={12} />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                  Client Secret
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showShopifySecret ? 'text' : 'password'}
                      value={shopifyClientSecret}
                      onChange={(e) => setShopifyClientSecret(e.target.value)}
                      placeholder="Shopify app Client Secret"
                      className="w-full px-3 py-1.5 rounded-lg text-xs outline-none pr-8"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: '#F5F5F8',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowShopifySecret(!showShopifySecret)}
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                      style={{ color: '#555' }}
                    >
                      {showShopifySecret ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                  <button
                    onClick={() => onUpdateBrand(brand.id, 'shopify_client_secret', shopifyClientSecret)}
                    className="px-2 py-1 rounded-lg"
                    style={{ backgroundColor: 'rgba(150,191,72,0.15)', color: '#96BF48' }}
                  >
                    <Check size={12} />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                  Gross Margin %
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={shopifyMargin}
                    onChange={(e) => setShopifyMargin(e.target.value)}
                    placeholder="62"
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#F5F5F8',
                    }}
                  />
                  <button
                    onClick={() => onUpdateBrand(brand.id, 'shopify_gross_margin_pct', shopifyMargin)}
                    className="px-2 py-1 rounded-lg"
                    style={{ backgroundColor: 'rgba(150,191,72,0.15)', color: '#96BF48' }}
                  >
                    <Check size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Members list */}
      {expanded && (
        <div className="px-2 py-2">
          {members.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">No members assigned to this team</p>
          ) : (
            members.map((m) => (
              <MemberRow
                key={m.id}
                user={m}
                onUpdatePermission={onUpdatePermission}
                onUpdateRole={onUpdateRole}
                onRemoveFromTeam={onRemoveMember}
                saving={saving}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Create Team Modal ──────────────────────────────────────── */

function CreateTeamModal({
  open,
  onClose,
  onCreate,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, website: string, metaAdAccountId: string, googleAdsCustomerId: string) => void;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [metaAdAccountId, setMetaAdAccountId] = useState('');
  const [googleAdsCustomerId, setGoogleAdsCustomerId] = useState('');

  if (!open) return null;

  const inputStyle = {
    backgroundColor: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#F5F5F8',
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-2xl z-50 overflow-hidden"
        style={{
          backgroundColor: '#111111',
          border: '1px solid rgba(200,184,154,0.12)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-5 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(200,184,154,0.2), rgba(200,184,154,0.05))' }}
            >
              <Plus size={18} style={{ color: '#C8B89A' }} />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#F5F5F8]">Create New Team</h3>
              <p className="text-[11px] text-gray-500">New brand and its creative portal</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-all hover:bg-white/[0.05]"
            style={{ color: '#555' }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Brand Name */}
          <div>
            <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
              Team / Brand Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FOND Bone Broth"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
          </div>

          {/* Website */}
          <div>
            <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
              Website <span className="text-gray-600 normal-case">(optional)</span>
            </label>
            <input
              type="text"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
          </div>

          {/* Ad Accounts — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                Meta Ad Account <span className="text-gray-600 normal-case">(optional)</span>
              </label>
              <input
                type="text"
                value={metaAdAccountId}
                onChange={(e) => setMetaAdAccountId(e.target.value)}
                placeholder="act_123456789"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none font-mono"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                Google Ads ID <span className="text-gray-600 normal-case">(optional)</span>
              </label>
              <input
                type="text"
                value={googleAdsCustomerId}
                onChange={(e) => setGoogleAdsCustomerId(e.target.value)}
                placeholder="1234567890"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none font-mono"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{ color: '#888' }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (name.trim()) onCreate(name.trim(), website.trim(), metaAdAccountId.trim(), googleAdsCustomerId.trim());
              }}
              disabled={!name.trim() || saving}
              className="px-5 py-2.5 rounded-lg text-sm font-bold transition-all"
              style={{
                backgroundColor: name.trim() ? '#C8B89A' : 'rgba(200,184,154,0.2)',
                color: name.trim() ? '#0A0A0A' : '#666',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Creating…' : 'Create Team'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Invite Member Modal ────────────────────────────────────── */

const ROLE_CONFIG = {
  admin: { label: 'Admin', color: '#C8B89A', bg: 'rgba(200,184,154,0.15)', desc: 'Full access to everything' },
  founder: { label: 'Founder', color: '#34A853', bg: 'rgba(52,168,83,0.15)', desc: 'Brand owner — view P&L, campaigns, analytics' },
  strategist: { label: 'Strategist', color: '#5B8DEE', bg: 'rgba(91,141,238,0.15)', desc: 'Team member — creatives, uploads, pipeline' },
} as const;

interface InviteResult {
  email: string;
  tempPassword: string;
  fullName: string;
  role: string;
  isExisting?: boolean;
}

function InviteMemberModal({
  open,
  onClose,
  brands,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  brands: Brand[];
  onCreated: () => void;
}) {
  const supabase = createClient();
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'admin' | 'strategist' | 'founder'>('strategist');
  const [brandId, setBrandId] = useState<string>('');
  const [tempPassword, setTempPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);

  // Success state
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const resetForm = () => {
    setStep('form');
    setEmail('');
    setFullName('');
    setRole('strategist');
    setBrandId('');
    setTempPassword('');
    setShowPassword(false);
    setSendWelcomeEmail(true);
    setError(null);
    setResult(null);
    setCopied(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setTempPassword(pw);
  };

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSubmit = async () => {
    setError(null);

    if (!email.trim()) { setError('Email is required'); return; }
    if (!tempPassword) { setError('Set a temporary password'); return; }
    if (tempPassword.length < 8) { setError('Password must be at least 8 characters'); return; }

    setSaving(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Not authenticated'); setSaving(false); return; }

      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          fullName: fullName.trim() || undefined,
          role,
          brandId: brandId || undefined,
          tempPassword,
          sendWelcomeEmail,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create user');
        setSaving(false);
        return;
      }

      setResult({
        email: email.trim().toLowerCase(),
        tempPassword,
        fullName: fullName.trim() || email.split('@')[0],
        role,
        isExisting: data.isExisting || false,
      });
      setStep('success');
      onCreated();
    } catch {
      setError('Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={handleClose} />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-2xl z-50 overflow-hidden"
        style={{
          backgroundColor: '#111111',
          border: '1px solid rgba(200,184,154,0.12)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-5 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(200,184,154,0.2), rgba(200,184,154,0.05))' }}
            >
              <UserPlus size={18} style={{ color: '#C8B89A' }} />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#F5F5F8]">
                {step === 'form' ? 'Invite Member' : 'Member Created'}
              </h3>
              <p className="text-[11px] text-gray-500">
                {step === 'form'
                  ? 'Add a new user to the platform'
                  : 'Share these credentials securely'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg transition-all hover:bg-white/[0.05]"
            style={{ color: '#555' }}
          >
            <X size={18} />
          </button>
        </div>

        {step === 'form' ? (
          <div className="px-6 py-5 space-y-4">
            {/* Error */}
            {error && (
              <div
                className="px-3 py-2.5 rounded-lg flex items-center gap-2 text-xs"
                style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#EF4444' }}
              >
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            {/* Email */}
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                Email Address
              </label>
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <Mail size={14} style={{ color: '#555' }} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoFocus
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: '#F5F5F8' }}
                />
              </div>
            </div>

            {/* Full Name */}
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                Full Name <span className="text-gray-600 normal-case">(optional)</span>
              </label>
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <User size={14} style={{ color: '#555' }} />
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Peter Smith"
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: '#F5F5F8' }}
                />
              </div>
            </div>

            {/* Role Selector */}
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-2 uppercase tracking-wider">
                Role
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(ROLE_CONFIG) as Array<keyof typeof ROLE_CONFIG>).map((r) => {
                  const cfg = ROLE_CONFIG[r];
                  const active = role === r;
                  return (
                    <button
                      key={r}
                      onClick={() => setRole(r)}
                      className="relative px-3 py-3 rounded-xl text-left transition-all"
                      style={{
                        backgroundColor: active ? cfg.bg : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${active ? cfg.color + '40' : 'rgba(255,255,255,0.06)'}`,
                      }}
                    >
                      <p
                        className="text-xs font-bold"
                        style={{ color: active ? cfg.color : '#888' }}
                      >
                        {cfg.label}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: '#555' }}>
                        {cfg.desc}
                      </p>
                      {active && (
                        <div
                          className="absolute top-2 right-2 w-2 h-2 rounded-full"
                          style={{ backgroundColor: cfg.color }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Brand Assignment */}
            {role !== 'admin' && (
              <div>
                <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                  Assign to Brand <span className="text-gray-600 normal-case">(optional)</span>
                </label>
                <select
                  value={brandId}
                  onChange={(e) => setBrandId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none appearance-none cursor-pointer"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: brandId ? '#F5F5F8' : '#555',
                  }}
                >
                  <option value="">No brand assigned</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Temp Password */}
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1.5 uppercase tracking-wider">
                Temporary Password
              </label>
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <Lock size={14} style={{ color: '#555' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: '#F5F5F8' }}
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1 rounded transition-colors hover:bg-white/[0.05]"
                  style={{ color: '#555' }}
                  type="button"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />
                <button
                  onClick={generatePassword}
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-all hover:bg-white/[0.05]"
                  style={{ color: '#C8B89A' }}
                  type="button"
                >
                  Generate
                </button>
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: '#444' }}>
                User will change this on their first login via Account Settings
              </p>
            </div>

            {/* Welcome Email Toggle */}
            <label
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer select-none transition-colors hover:bg-white/[0.03]"
              style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <input
                type="checkbox"
                checked={sendWelcomeEmail}
                onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                className="w-4 h-4 rounded cursor-pointer accent-[#C8B89A]"
              />
              <div className="flex-1">
                <p className="text-xs font-medium" style={{ color: '#F5F5F8' }}>
                  Send welcome email
                </p>
                <p className="text-[10px]" style={{ color: '#555' }}>
                  Emails the user a branded intro with their sign-in link
                </p>
              </div>
            </label>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <button
                onClick={handleClose}
                className="px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{ color: '#888' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !email.trim() || !tempPassword}
                className="px-5 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2"
                style={{
                  backgroundColor: email.trim() && tempPassword ? '#C8B89A' : 'rgba(200,184,154,0.2)',
                  color: email.trim() && tempPassword ? '#0A0A0A' : '#666',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? (
                  <>
                    <Loader size={14} className="animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <UserPlus size={14} />
                    Create User
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* ── Success State ── */
          <div className="px-6 py-5 space-y-4">
            {/* Success badge */}
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ backgroundColor: 'rgba(52,168,83,0.08)', border: '1px solid rgba(52,168,83,0.15)' }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'rgba(52,168,83,0.2)' }}
              >
                <Check size={16} style={{ color: '#34A853' }} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: '#34A853' }}>
                  {result?.fullName} has been {result?.isExisting ? 'updated' : 'added'}
                </p>
                <p className="text-[11px]" style={{ color: '#555' }}>
                  {result?.isExisting ? 'Existing account — password reset & profile updated' : `Role: ${ROLE_CONFIG[result?.role as keyof typeof ROLE_CONFIG]?.label || result?.role}`}
                </p>
              </div>
            </div>

            {/* Credential card */}
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid rgba(200,184,154,0.12)' }}
            >
              <div
                className="px-4 py-3 flex items-center justify-between"
                style={{ background: 'linear-gradient(135deg, rgba(200,184,154,0.08), rgba(200,184,154,0.02))' }}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#C8B89A' }}>
                  Login Credentials
                </span>
                <button
                  onClick={() => {
                    const text = `melch.cloud\nEmail: ${result?.email}\nTemp Password: ${result?.tempPassword}\n\nPlease change your password after first login.`;
                    handleCopy(text, 'all');
                  }}
                  className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md transition-all hover:bg-white/[0.05]"
                  style={{ color: copied === 'all' ? '#34A853' : '#C8B89A' }}
                >
                  {copied === 'all' ? <Check size={12} /> : <Copy size={12} />}
                  {copied === 'all' ? 'Copied' : 'Copy All'}
                </button>
              </div>
              <div className="px-4 py-3 space-y-3" style={{ backgroundColor: 'rgba(255,255,255,0.015)' }}>
                {/* URL */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">URL</p>
                    <p className="text-sm font-mono" style={{ color: '#F5F5F8' }}>melch.cloud</p>
                  </div>
                </div>
                {/* Email */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Email</p>
                    <p className="text-sm font-mono" style={{ color: '#F5F5F8' }}>{result?.email}</p>
                  </div>
                  <button
                    onClick={() => handleCopy(result?.email || '', 'email')}
                    className="p-1.5 rounded-lg transition-all hover:bg-white/[0.05]"
                    style={{ color: copied === 'email' ? '#34A853' : '#555' }}
                  >
                    {copied === 'email' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                {/* Password */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Temp Password</p>
                    <p className="text-sm font-mono" style={{ color: '#C8B89A' }}>{result?.tempPassword}</p>
                  </div>
                  <button
                    onClick={() => handleCopy(result?.tempPassword || '', 'pw')}
                    className="p-1.5 rounded-lg transition-all hover:bg-white/[0.05]"
                    style={{ color: copied === 'pw' ? '#34A853' : '#555' }}
                  >
                    {copied === 'pw' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-center" style={{ color: '#444' }}>
              The user should change their password after first login via Account Settings
            </p>

            {/* Actions */}
            <div className="flex justify-between pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <button
                onClick={() => resetForm()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:bg-white/[0.03]"
                style={{ color: '#C8B89A' }}
              >
                <UserPlus size={14} />
                Invite Another
              </button>
              <button
                onClick={handleClose}
                className="px-5 py-2.5 rounded-lg text-sm font-bold transition-all"
                style={{ backgroundColor: '#C8B89A', color: '#0A0A0A' }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ─── Main Page ──────────────────────────────────────────────── */

export default function TeamPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const toast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  const fetchData = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (!profile || profile.role !== 'admin') {
        router.push('/submissions');
        return;
      }

      // Fetch brands
      const { data: allBrands } = await supabase
        .from('brands')
        .select('id, name, slug, website_url, meta_ad_account_id, google_ads_customer_id, shopify_store_domain, shopify_client_id, shopify_client_secret, shopify_gross_margin_pct')
        .order('name');
      setBrands(allBrands || []);

      // Fetch users
      const { data: allUsers } = await supabase
        .from('users_profile')
        .select('id, email, full_name, role, brand_id')
        .order('email');

      // Fetch permissions
      const userIds = (allUsers || []).map((u: any) => u.id);
      let permsMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: perms } = await supabase
          .from('user_permissions')
          .select('user_id, can_upload, can_view_pipeline, can_download, can_delete, is_active')
          .in('user_id', userIds);
        permsMap = (perms || []).reduce((acc: any, p: any) => {
          acc[p.user_id] = p;
          return acc;
        }, {});
      }

      setUsers(
        (allUsers || []).map((u: any) => ({
          id: u.id,
          email: u.email,
          full_name: u.full_name || '',
          role: u.role,
          brand_id: u.brand_id,
          permissions: permsMap[u.id] || {
            can_upload: false,
            can_view_pipeline: false,
            can_download: false,
            can_delete: false,
            is_active: true,
          },
        }))
      );

      setLoading(false);
    } catch {
      setError('Failed to load data');
      setLoading(false);
    }
  }, [supabase, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Handlers ── */

  const handleUpdatePermission = useCallback(
    async (userId: string, field: string, value: boolean) => {
      setSaving(true);
      const { error: err } = await supabase
        .from('user_permissions')
        .update({ [field]: value })
        .eq('user_id', userId);

      if (err) {
        setError(err.message);
      } else {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? { ...u, permissions: { ...u.permissions, [field]: value } }
              : u
          )
        );
        toast('Permission updated');
      }
      setSaving(false);
    },
    [supabase]
  );

  const handleUpdateRole = useCallback(
    async (userId: string, role: 'admin' | 'strategist' | 'founder') => {
      setSaving(true);
      const { error: err } = await supabase
        .from('users_profile')
        .update({ role })
        .eq('id', userId);

      if (err) {
        setError(err.message);
      } else {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role } : u))
        );
        toast('Role updated');
      }
      setSaving(false);
    },
    [supabase]
  );

  const handleAddMember = useCallback(
    async (userId: string, brandId: string) => {
      setSaving(true);
      const { error: err } = await supabase
        .from('users_profile')
        .update({ brand_id: brandId })
        .eq('id', userId);

      if (err) {
        setError(err.message);
      } else {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, brand_id: brandId } : u))
        );
        toast('Member added to team');
      }
      setSaving(false);
    },
    [supabase]
  );

  const handleRemoveMember = useCallback(
    async (userId: string) => {
      setSaving(true);
      const { error: err } = await supabase
        .from('users_profile')
        .update({ brand_id: null })
        .eq('id', userId);

      if (err) {
        setError(err.message);
      } else {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, brand_id: null } : u))
        );
        toast('Member removed from team');
      }
      setSaving(false);
    },
    [supabase]
  );

  const handleUpdateBrand = useCallback(
    async (brandId: string, field: string, value: string) => {
      setSaving(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setError('Not authenticated'); setSaving(false); return; }

        const res = await fetch('/api/admin/brand-setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action: 'set_field', brandId, field, value: value || null }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Failed to update');
        } else {
          setBrands((prev) =>
            prev.map((b) => (b.id === brandId ? { ...b, [field]: value || null } : b))
          );
          toast('Team settings updated');
        }
      } catch {
        setError('Failed to update brand settings');
      }
      setSaving(false);
    },
    [supabase]
  );

  const handleCreateTeam = useCallback(
    async (name: string, website: string, metaAdAccountId?: string, googleAdsCustomerId?: string) => {
      setSaving(true);
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const insertData: Record<string, any> = { name, slug, website_url: website || null };
      if (metaAdAccountId) insertData.meta_ad_account_id = metaAdAccountId;
      if (googleAdsCustomerId) insertData.google_ads_customer_id = googleAdsCustomerId;

      const { data, error: err } = await supabase
        .from('brands')
        .insert(insertData)
        .select()
        .single();

      if (err) {
        setError(err.message);
      } else if (data) {
        setBrands((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        setShowCreateModal(false);
        toast(`Team "${name}" created`);
      }
      setSaving(false);
    },
    [supabase]
  );

  /* ── Derived data ── */

  // Group users by brand
  const teamMap = new Map<string, UserProfile[]>();
  const admins: UserProfile[] = [];
  const unassigned: UserProfile[] = [];

  for (const u of users) {
    if (u.role === 'admin') {
      admins.push(u);
    } else if (u.brand_id) {
      const arr = teamMap.get(u.brand_id) || [];
      arr.push(u);
      teamMap.set(u.brand_id, arr);
    } else {
      unassigned.push(u);
    }
  }

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <Loader className="w-8 h-8 text-[#C8B89A] animate-spin" />
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Users className="w-6 h-6 text-[#C8B89A]" />
              <h1 className="text-2xl font-bold text-[#F5F5F8] tracking-tight">
                Teams
              </h1>
            </div>
            <p className="text-sm text-gray-500">
              Manage brands, members, and permissions
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
              style={{
                backgroundColor: '#C8B89A',
                color: '#0A0A0A',
              }}
            >
              <UserPlus size={16} />
              Invite Member
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#888',
              }}
            >
              <Plus size={16} />
              New Team
            </button>
          </div>
        </div>

        {error && (
          <div
            className="mb-6 p-4 rounded-lg flex items-center gap-3"
            style={{
              backgroundColor: 'rgba(255,50,50,0.08)',
              border: '1px solid rgba(255,50,50,0.2)',
            }}
          >
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-400 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Admins section */}
        {admins.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-[#C8B89A]" />
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Administrators
              </h2>
            </div>
            <div
              className="rounded-xl overflow-hidden"
              style={{
                backgroundColor: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div className="px-2 py-2">
                {admins.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center gap-4 px-4 py-3 rounded-lg"
                  >
                    <UserInitial email={u.email} role={u.role} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#F5F5F8] truncate">
                        {u.full_name || u.email.split('@')[0]}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{u.email}</p>
                    </div>
                    <span
                      className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        backgroundColor: 'rgba(200,184,154,0.15)',
                        color: '#C8B89A',
                      }}
                    >
                      Admin
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Team cards */}
        <div className="space-y-4">
          {brands.filter((b) => b.name !== 'Test Brand').map((brand) => (
            <TeamCard
              key={brand.id}
              brand={brand}
              members={teamMap.get(brand.id) || []}
              allUsers={users}
              onUpdatePermission={handleUpdatePermission}
              onUpdateRole={handleUpdateRole}
              onAddMember={handleAddMember}
              onRemoveMember={handleRemoveMember}
              onUpdateBrand={handleUpdateBrand}
              saving={saving}
            />
          ))}
        </div>

        {/* Unassigned users */}
        {unassigned.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-gray-500" />
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Unassigned Users
              </h2>
            </div>
            <div
              className="rounded-xl overflow-hidden"
              style={{
                backgroundColor: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div className="px-2 py-2">
                {unassigned.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center gap-4 px-4 py-3 rounded-lg"
                  >
                    <UserInitial email={u.email} role={u.role} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#F5F5F8] truncate">
                        {u.full_name || u.email.split('@')[0]}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{u.email}</p>
                    </div>
                    <span className="text-xs text-gray-500">No team assigned</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <CreateTeamModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateTeam}
        saving={saving}
      />
      <InviteMemberModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        brands={brands}
        onCreated={() => {
          fetchData();
          toast('Member created');
        }}
      />
      <Toast message={toastMessage} visible={showToast} />
    </Navbar>
  );
}
