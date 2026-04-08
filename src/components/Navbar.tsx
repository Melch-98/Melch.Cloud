'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  LogOut,
  Upload,
  LayoutDashboard,
  GitBranch,
  ChevronLeft,
  ChevronRight,
  ChevronDown as ChevronDownIcon,
  Menu,
  X,
  Users,
  UserCircle,
  BarChart3,
  TrendingUp,
  CalendarDays,
  FileText,
  Lightbulb,
  Rocket,
  FlaskConical,
  Sparkles,
  Type,
  TableProperties,
  DollarSign,
  Activity,
  Video,
  Home,
} from 'lucide-react';
import { createClient } from '@/lib/supabase';

interface NavChild {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: string[];
}

interface NavLink {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: string[];
  badge?: string;
  external?: boolean;
  children?: NavChild[];
}

// Extract domain from a URL for favicon lookup
function getDomain(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname;
  } catch {
    return null;
  }
}

export default function Navbar({ children }: { children?: React.ReactNode }) {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [brandFavicon, setBrandFavicon] = useState<string | null>(null);
  const [faviconError, setFaviconError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user?.email) {
          setUserEmail(session.user.email);

          const { data: profile } = await supabase
            .from('users_profile')
            .select('role, brand_id')
            .eq('id', session.user.id)
            .single();

          if (profile) {
            setUserRole(profile.role);

            // For strategists/founders, fetch their brand to show the client favicon
            if (profile.brand_id) {
              const { data: brand } = await supabase
                .from('brands')
                .select('name, slug, website_url')
                .eq('id', profile.brand_id)
                .single();

              if (brand) {
                setBrandName(brand.name);
                // Use website_url if set, otherwise try slug as domain
                const domain = brand.website_url
                  ? getDomain(brand.website_url)
                  : null;
                if (domain) {
                  setBrandFavicon(
                    `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
                  );
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [supabase]);

  const navLinks: NavLink[] = [
    {
      label: 'Dashboard',
      href: '/dashboard',
      icon: Home,
      roles: ['founder', 'admin', 'strategist'],
    },
    {
      label: 'Upload',
      href: '/upload',
      icon: Upload,
      roles: ['strategist'],
    },
    {
      label: 'Pipeline',
      href: '/submissions',
      icon: GitBranch,
      roles: ['strategist'],
    },
    {
      label: 'Creative Queue',
      href: '/admin',
      icon: LayoutDashboard,
      roles: ['admin'],
    },
    {
      label: 'Analytics',
      href: '/analytics',
      icon: TrendingUp,
      roles: ['admin', 'strategist', 'founder'],
      badge: 'Beta',
      children: [
        { label: 'Daily P&L', href: '/analytics/daily-pnl', icon: DollarSign, roles: ['admin', 'founder'] },
        { label: 'Campaigns', href: '/analytics/campaigns', icon: Activity, roles: ['admin', 'founder', 'strategist'] },
        { label: 'Top Creatives', href: '/analytics', icon: Sparkles },
        { label: 'Copy Analysis', href: '/analytics/copy-analysis', icon: Type },
        { label: 'Ad Perspective', href: '/analytics/ad-perspective', icon: TableProperties },
      ],
    },
    // Hidden — Ad Changelog needs rework before re-enabling
    // {
    //   label: 'Ad Changelog',
    //   href: '/ad-changelog',
    //   icon: Activity,
    //   roles: ['admin', 'founder'],
    // },
    {
      label: 'Calendar',
      href: '/calendar',
      icon: CalendarDays,
      roles: ['admin', 'strategist', 'founder'],
      badge: 'Beta',
    },
    {
      label: 'Copy Templates',
      href: '/copy-templates',
      icon: FileText,
      roles: ['admin', 'strategist'],
    },
    {
      label: 'Ad Lab',
      href: '/ad-lab',
      icon: FlaskConical,
      roles: ['admin'],
      badge: 'Beta',
    },
    {
      label: 'Statistics',
      href: '/stats',
      icon: BarChart3,
      roles: ['admin'],
    },
    {
      label: 'Team',
      href: '/team',
      icon: Users,
      roles: ['admin'],
    },
    {
      label: 'Book a Call',
      href: 'https://calendar.proton.me/bookings#v8kOqlT5iUURM7eCJ6GVXS7AMsKxa0ly4VwimFden-M=',
      icon: Video,
      roles: ['founder', 'strategist'],
      external: true,
    },
    {
      label: 'Releases',
      href: '/releases',
      icon: Rocket,
      roles: ['admin', 'founder', 'strategist'],
    },
    {
      label: 'Feature Requests',
      href: '/feature-requests',
      icon: Lightbulb,
      roles: ['admin', 'founder', 'strategist'],
    },
    {
      label: 'Account',
      href: '/account',
      icon: UserCircle,
      roles: ['strategist', 'admin', 'founder'],
    },
  ];

  const visibleLinks = navLinks.filter(
    (link) => !link.roles || link.roles.includes(userRole || '')
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const isLinkActive = (href: string) => pathname === href;
  const isParentActive = (link: NavLink) =>
    link.children ? link.children.some((c) => pathname === c.href) : false;

  // Auto-expand parents whose children are active
  useEffect(() => {
    const newExpanded = new Set<string>();
    visibleLinks.forEach((link) => {
      if (link.children && link.children.some((c) => pathname === c.href)) {
        newExpanded.add(link.label);
      }
    });
    if (newExpanded.size > 0) {
      setExpandedParents((prev) => {
        const merged = new Set(prev);
        newExpanded.forEach((l) => merged.add(l));
        return merged;
      });
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleParent = (label: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const firstName = userEmail?.split('@')[0] || '';

  // ─── Sidebar content (shared between desktop and mobile) ─────
  const sidebarContent = (isMobile: boolean) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-5 h-16 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* Logo mark — client favicon for strategists, gold M for admin */}
        {brandFavicon && !faviconError ? (
          <div
            className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={brandFavicon}
              alt={brandName || 'Brand'}
              width={32}
              height={32}
              className="w-full h-full object-cover"
              onError={() => setFaviconError(true)}
            />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/melch-icon.svg"
            alt="melch.cloud"
            width={32}
            height={32}
            className="w-8 h-8 rounded-lg flex-shrink-0"
          />
        )}
        {(!collapsed || isMobile) && (
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold text-[#F5F5F8] leading-tight tracking-tight">
              melch<span style={{ color: '#C8B89A' }}>.cloud</span>
            </span>
            <span className="text-[10px] text-gray-500 leading-tight tracking-wider uppercase">
              Command Center
            </span>
          </div>
        )}
      </div>

      {/* Nav links */}
      <div className="flex-1 py-4 px-3 space-y-1">
        {!loading &&
          visibleLinks.map((link) => {
            const hasChildren = !!link.children && link.children.length > 0;
            const isExpanded = expandedParents.has(link.label);
            const parentActive = isParentActive(link);
            const isActive = !hasChildren && isLinkActive(link.href);
            const isHighlighted = isActive || parentActive;
            const LinkIcon = link.icon;

            return (
              <div key={link.href}>
                {/* Parent / standalone link */}
                <a
                  href={hasChildren ? undefined : link.href}
                  target={link.external ? '_blank' : undefined}
                  rel={link.external ? 'noopener noreferrer' : undefined}
                  onClick={(e) => {
                    if (link.external) {
                      e.preventDefault();
                      window.open(link.href, '_blank', 'noopener,noreferrer');
                      return;
                    }
                    if (hasChildren) {
                      e.preventDefault();
                      if (collapsed && !isMobile) {
                        // When collapsed, clicking expands sidebar and opens children
                        setCollapsed(false);
                        if (!isExpanded) toggleParent(link.label);
                      } else {
                        toggleParent(link.label);
                      }
                    } else {
                      if (isMobile) setMobileOpen(false);
                    }
                  }}
                  className="group flex items-center gap-3 rounded-lg transition-all relative cursor-pointer"
                  style={{
                    padding: collapsed && !isMobile ? '10px 12px' : '10px 14px',
                    backgroundColor: isHighlighted
                      ? 'rgba(200,184,154,0.1)'
                      : 'transparent',
                    color: isHighlighted ? '#C8B89A' : '#888',
                  }}
                  title={collapsed && !isMobile ? link.label : undefined}
                >
                  {/* Active indicator bar */}
                  {isHighlighted && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full"
                      style={{
                        height: '60%',
                        backgroundColor: '#C8B89A',
                      }}
                    />
                  )}
                  <LinkIcon
                    size={20}
                    className="flex-shrink-0 transition-colors"
                    style={{
                      color: isHighlighted ? '#C8B89A' : undefined,
                    }}
                  />
                  {(!collapsed || isMobile) && (
                    <>
                      <span
                        className="text-sm font-medium transition-colors flex items-center gap-2 flex-1"
                        style={{
                          color: isHighlighted ? '#C8B89A' : undefined,
                        }}
                      >
                        {link.label}
                        {link.badge && (
                          <span
                            className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: 'rgba(200,184,154,0.15)',
                              color: '#C8B89A',
                            }}
                          >
                            {link.badge}
                          </span>
                        )}
                      </span>
                      {hasChildren && (
                        <ChevronDownIcon
                          size={14}
                          className="flex-shrink-0 transition-transform duration-200"
                          style={{
                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                            color: isHighlighted ? '#C8B89A' : '#555',
                          }}
                        />
                      )}
                    </>
                  )}
                  {/* Hover highlight */}
                  {!isHighlighted && (
                    <div
                      className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                      style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                    />
                  )}
                </a>

                {/* Children sub-nav */}
                {hasChildren && isExpanded && (!collapsed || isMobile) && (
                  <div className="ml-4 mt-1 space-y-0.5" style={{ borderLeft: '1px solid rgba(200,184,154,0.12)', paddingLeft: '12px' }}>
                    {link.children!.filter((child) => !child.roles || child.roles.includes(userRole || '')).map((child) => {
                      const childActive = isLinkActive(child.href);
                      const ChildIcon = child.icon;
                      return (
                        <a
                          key={child.href}
                          href={child.href}
                          onClick={() => isMobile && setMobileOpen(false)}
                          className="group flex items-center gap-2.5 rounded-md transition-all relative"
                          style={{
                            padding: '8px 10px',
                            backgroundColor: childActive
                              ? 'rgba(200,184,154,0.08)'
                              : 'transparent',
                            color: childActive ? '#C8B89A' : '#666',
                          }}
                        >
                          <ChildIcon
                            size={16}
                            className="flex-shrink-0 transition-colors"
                            style={{ color: childActive ? '#C8B89A' : undefined }}
                          />
                          <span
                            className="text-[13px] font-medium transition-colors"
                            style={{ color: childActive ? '#C8B89A' : undefined }}
                          >
                            {child.label}
                          </span>
                          {!childActive && (
                            <div
                              className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                              style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                            />
                          )}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Bottom: logout + collapse toggle */}
      <div
        className="flex-shrink-0 px-3 py-3 space-y-1"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* Logout button */}
        {!loading && userEmail && (
          <button
            onClick={handleLogout}
            className="group w-full flex items-center gap-3 rounded-lg transition-all relative"
            style={{
              padding: collapsed && !isMobile ? '10px 12px' : '10px 14px',
              color: '#555',
            }}
            title={collapsed && !isMobile ? 'Sign out' : undefined}
          >
            <LogOut size={20} className="flex-shrink-0" />
            {(!collapsed || isMobile) && (
              <span className="text-sm font-medium">Sign out</span>
            )}
            <div
              className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
            />
          </button>
        )}

        {/* Collapse toggle - desktop only */}
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center py-2 rounded-lg transition-colors"
            style={{
              backgroundColor: 'rgba(255,255,255,0.03)',
              color: '#555',
            }}
          >
            {collapsed ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronLeft size={16} />
            )}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: '#0A0A0A' }}>
      {/* ─── Desktop sidebar ──────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col flex-shrink-0 sticky top-0 h-screen transition-all duration-200 z-50"
        style={{
          width: collapsed ? '72px' : '240px',
          backgroundColor: '#0D0D0D',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {sidebarContent(false)}
      </aside>

      {/* ─── Mobile top bar ───────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4"
        style={{
          backgroundColor: 'rgba(13,13,13,0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-center gap-2">
          {brandFavicon && !faviconError ? (
            <div
              className="w-7 h-7 rounded-md overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brandFavicon}
                alt={brandName || 'Brand'}
                width={28}
                height={28}
                className="w-full h-full object-cover"
                onError={() => setFaviconError(true)}
              />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/melch-icon.svg"
              alt="melch.cloud"
              width={28}
              height={28}
              className="w-7 h-7 rounded-md"
            />
          )}
          <span className="text-sm font-bold text-[#F5F5F8]">
            melch<span style={{ color: '#C8B89A' }}>.cloud</span>
          </span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg"
          style={{ color: '#888' }}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* ─── Mobile drawer ────────────────────────────────────── */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="md:hidden fixed top-0 left-0 bottom-0 z-50 w-64 flex flex-col"
            style={{
              backgroundColor: '#0D0D0D',
              borderRight: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {sidebarContent(true)}
          </aside>
        </>
      )}

      {/* ─── Main content ─────────────────────────────────────── */}
      <main className="flex-1 min-w-0 md:pt-0 pt-14">
        {children}
      </main>
    </div>
  );
}
