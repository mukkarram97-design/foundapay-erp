import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Keyboard, Link2, ListChecks,
  Users, Wallet, AlertTriangle, Lock, Repeat,
  Building2, CreditCard, Shuffle,
  CreditCard as CardIcon, Receipt, Boxes,
  BarChart3, CalendarDays, TrendingUp, UserCog, BookOpen,
  ShieldCheck, FileText, Settings, ChevronLeft, ChevronDown, LogOut, Briefcase, Users2,
} from 'lucide-react';
import { useAuth } from '../../store/auth';
import { Logo, LogoMark, Badge } from '../ui';
import GlobalSearch from '../ui/GlobalSearch';
import NotificationsBell from '../ui/NotificationsBell';
import ThemeToggle from '../ui/ThemeToggle';

const NAV_GROUPS = [
  { id: 'ops', label: 'Operations', items: [
    { to: '/dashboard',        label: 'Dashboard',        icon: LayoutDashboard },
    { to: '/virtual-terminal', label: 'Virtual Terminal', icon: Keyboard, hot: true },
    { to: '/payment-links',    label: 'Payment Links',    icon: Link2 },
    { to: '/transactions',     label: 'Master Ledger',    icon: ListChecks },
  ]},
  { id: 'finance', label: 'Finance', items: [
    { to: '/clients',         label: 'Clients',          icon: Users },
    { to: '/payouts',         label: 'Payouts',          icon: Wallet },
    { to: '/chargebacks',     label: 'Chargebacks',      icon: AlertTriangle, key: 'cb' },
    { to: '/reserves',        label: 'Reserves',         icon: Lock },
    { to: '/reconciliation',  label: 'Reconciliation',   icon: Repeat },
    { to: '/brokers',         label: 'Brokers',          icon: Briefcase },
    { to: '/partners',        label: 'Partners',         icon: Users2 },
  ]},
  { id: 'infra', label: 'Infrastructure', items: [
    { to: '/entities',  label: 'Entities',     icon: Building2 },
    { to: '/merchants', label: 'Merchants',    icon: CreditCard },
    { to: '/routing',   label: 'Auto-Routing', icon: Shuffle },
  ]},
  { id: 'expenses', label: 'Expenses', items: [
    { to: '/cards',    label: 'Cards',            icon: CardIcon, key: 'cards' },
    { to: '/expenses', label: 'Expenses',         icon: Receipt },
    { to: '/assets',   label: 'Assets & Domains', icon: Boxes },
  ]},
  { id: 'reporting', label: 'Reporting', items: [
    { to: '/reports',     label: 'Reports',     icon: BarChart3 },
    { to: '/april-2026',  label: 'April 2026',  icon: CalendarDays },
    { to: '/q1-2026',     label: 'Q1 2026',     icon: TrendingUp },
    { to: '/payroll',     label: 'Payroll',     icon: UserCog },
    { to: '/accounting',  label: 'Accounting',  icon: BookOpen },
  ]},
  { id: 'system', label: 'System', items: [
    { to: '/users',    label: 'Users & Roles', icon: ShieldCheck },
    { to: '/audit',    label: 'Audit Logs',    icon: FileText },
    { to: '/settings', label: 'Settings / CMS', icon: Settings },
  ]},
];

const COLLAPSE_KEY = 'fp_sidebar_collapsed';
const GROUPS_KEY = 'fp_sidebar_groups';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [groupOpen, setGroupOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(GROUPS_KEY)) || {}; }
    catch { return {}; }
  });

  // Counts (cards count, open chargebacks)
  const [counts, setCounts] = useState({ cards: 0, cb: 0 });
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/cards', { headers: authHeader() }).then((r) => r.json()).catch(() => ({ rows: [] })),
      fetch('/api/chargebacks', { headers: authHeader() }).then((r) => r.json()).catch(() => ({ rows: [] })),
    ]).then(([c, cb]) => {
      if (!alive) return;
      const openCb = (cb.rows || []).filter((r) => r.status === 'open' || r.status === 'evidence_submitted').length;
      setCounts({ cards: (c.rows || []).length, cb: openCb });
    });
    return () => { alive = false; };
  }, [location.pathname]);

  function toggleGroup(id) {
    const next = { ...groupOpen, [id]: !isOpen(id) };
    localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
    setGroupOpen(next);
  }
  function isOpen(id) {
    if (groupOpen[id] === undefined) return true;
    return !!groupOpen[id];
  }
  function toggleCollapse() {
    const next = !collapsed;
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    setCollapsed(next);
  }

  const pageTitle = derivePageTitle(location.pathname);
  const sidebarWidth = collapsed ? 60 : 220;

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      <aside
        className="flex flex-col border-r transition-all duration-200"
        style={{
          width: sidebarWidth,
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border)',
          flexShrink: 0,
        }}
      >
        <div className="flex items-center justify-between px-3 py-4" style={{ height: 56 }}>
          {collapsed
            ? <LogoMark size={32} />
            : <NavLink to="/dashboard"><Logo size={28} /></NavLink>}
          <button onClick={toggleCollapse} className="opacity-50 hover:opacity-100 p-1" title={collapsed ? 'Expand' : 'Collapse'}>
            <ChevronLeft size={14} style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-3">
              {!collapsed && (
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-3 mt-2 mb-0.5 text-[10px] font-semibold uppercase tracking-widest opacity-70 hover:opacity-100"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    size={11}
                    style={{ transform: isOpen(group.id) ? 'none' : 'rotate(-90deg)', transition: 'transform 150ms' }}
                  />
                </button>
              )}
              {(isOpen(group.id) || collapsed) && (
                <div className="space-y-0.5 mt-0.5">
                  {group.items.map((item) => (
                    <NavItem key={item.to} item={item} count={counts[item.key]} collapsed={collapsed} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="border-t" style={{ borderColor: 'var(--border)', padding: 8 }}>
          {!collapsed ? (
            <div className="flex items-center gap-2 px-2 py-2">
              <Avatar name={user?.name || user?.email} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{user?.name || user?.email}</div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{user?.role}</div>
              </div>
              <button
                onClick={async () => { await logout(); navigate('/login', { replace: true }); }}
                className="p-1.5 opacity-60 hover:opacity-100 rounded"
                title="Sign out"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={async () => { await logout(); navigate('/login', { replace: true }); }}
              className="flex items-center justify-center w-full h-9 opacity-70 hover:opacity-100"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar — 3-column flex: title (left) | search (center) | actions (right) */}
        <header
          className="flex items-center justify-between border-b"
          style={{
            height: 56,
            padding: '0 20px',
            gap: 16,
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          {/* LEFT — page title */}
          <div className="flex items-center" style={{ flex: '0 0 auto' }}>
            <h1 className="font-semibold truncate" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
              {pageTitle}
            </h1>
          </div>

          {/* CENTER — global search (hidden on mobile) */}
          <div className="hidden md:flex items-center justify-center" style={{ flex: 1 }}>
            <GlobalSearch />
          </div>

          {/* RIGHT — actions */}
          <div className="flex items-center" style={{ gap: 12, flex: '0 0 auto' }}>
            {user?.role === 'super_admin' && (
              <span
                style={{
                  background: 'rgba(124,58,237,0.15)',
                  border: '1px solid rgba(124,58,237,0.4)',
                  color: '#A78BFA',
                  borderRadius: 6,
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >Super Admin</span>
            )}
            <NotificationsBell />
            <ThemeToggle />
            <GradientAvatar name={user?.name || user?.email} />
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function NavItem({ item, count, collapsed }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded-lg text-[13px] font-medium transition relative ${
          isActive ? 'fp-nav-active' : ''
        }`
      }
      style={({ isActive }) => ({
        color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
        background: isActive ? 'var(--accent-dim)' : 'transparent',
      })}
    >
      <Icon size={15} className="flex-shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {item.hot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />}
          {count > 0 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
              style={{
                background: item.key === 'cb' ? 'var(--danger-dim)' : 'var(--bg-tertiary)',
                color: item.key === 'cb' ? 'var(--danger)' : 'var(--text-tertiary)',
              }}
            >
              {count}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function Avatar({ name = '', className = '' }) {
  const initials = (name || '')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((s) => s[0]).join('').toUpperCase() || 'FP';
  return (
    <div
      className={`flex items-center justify-center rounded-full text-[11px] font-semibold ${className}`}
      style={{ width: 28, height: 28, background: 'var(--accent-dim)', color: 'var(--accent)' }}
    >{initials}</div>
  );
}

function GradientAvatar({ name = '' }) {
  const initials = (name || '')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((s) => s[0]).join('').toUpperCase() || 'FP';
  return (
    <button
      title={name}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #7C3AED, #5B21B6)',
        color: 'white',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >{initials}</button>
  );
}

function authHeader() {
  const token = localStorage.getItem('foundapay_token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function derivePageTitle(p) {
  const map = {
    '/dashboard': 'Dashboard',
    '/virtual-terminal': 'Virtual Terminal',
    '/transactions': 'Master Ledger',
    '/payment-links': 'Payment Links',
    '/clients': 'Clients',
    '/payouts': 'Payouts',
    '/chargebacks': 'Chargebacks',
    '/reserves': 'Reserves',
    '/reconciliation': 'Reconciliation',
    '/brokers': 'Brokers',
    '/partners': 'Partners',
    '/entities': 'Entities',
    '/merchants': 'Merchants',
    '/routing': 'Auto-Routing',
    '/cards': 'Cards',
    '/expenses': 'Expenses',
    '/assets': 'Assets & Domains',
    '/reports': 'Reports',
    '/april-2026': 'April 2026',
    '/q1-2026': 'Q1 2026',
    '/payroll': 'Payroll',
    '/salary': 'Payroll',
    '/accounting': 'Accounting',
    '/users': 'Users & Roles',
    '/audit': 'Audit Logs',
    '/settings': 'Settings',
  };
  return map[p] || 'FoundaPay';
}
