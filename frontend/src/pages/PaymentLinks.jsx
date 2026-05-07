// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Payment Requests — unified page for simple links + invoices.
// Source of truth: payment_link_requests; invoices joined by invoice_number.
// row.type = 'invoice' when joined; 'link' otherwise.
//
// UX principles enforced here:
//   - Row click opens a RIGHT-side slide-over (400px). Table never
//     reflows. Click X / outside / Esc to close. Click another row
//     to swap the slide-over content.
//   - Selected row gets a 3px left-border accent (purple).
//   - Filters live in a 2-row bar: status tabs (row 1) + search +
//     dropdowns (row 2). Filter state syncs to URL so screens are
//     shareable.
//   - Mobile (< 768px): table collapses to a card list and the
//     slide-over fills the viewport.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreVertical, Copy, ExternalLink, QrCode, Mail, Eye, Edit2, XCircle, Plus, Search, X,
  Link as LinkIcon, FileSpreadsheet, ChevronDown, Trash2, Download,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import SlideOver from '../components/ui/SlideOver';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';

const TABS = [
  { id: 'all',          label: 'All' },
  { id: 'pending',      label: 'Pending' },
  { id: 'paid',         label: 'Paid' },
  { id: 'expired',      label: 'Expired' },
  { id: 'cancelled',    label: 'Cancelled' },
  { id: 'invoices',     label: 'Invoices' },
  { id: 'simple_links', label: 'Simple Links' },
];

const STATUS_DISPLAY = {
  paid:              { label: 'Paid ✓', tone: 'success' },
  cancelled:         { label: 'Cancelled', tone: 'danger' },
  failed:            { label: 'Failed', tone: 'danger' },
  refunded:          { label: 'Refunded', tone: 'danger' },
  expired:           { label: 'Expired', tone: 'neutral' },
  link_generated:    { label: 'Pending', tone: 'warning' },
  pending:           { label: 'Pending', tone: 'warning' },
  requested:         { label: 'Pending', tone: 'warning' },
  assigned:          { label: 'Pending', tone: 'warning' },
  merchant_selected: { label: 'Pending', tone: 'warning' },
  sent_to_client:    { label: 'Pending', tone: 'warning' },
  sent_to_customer:  { label: 'Pending', tone: 'warning' },
  waiting_payment:   { label: 'Pending', tone: 'warning' },
};
function statusDisplay(status) {
  return STATUS_DISPLAY[status] || { label: status || '—', tone: 'neutral' };
}

function relativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function activitySummary(row) {
  const log = row.access_log || {};
  const status = row.status;
  const opened = log.view_count > 0 || !!log.first_opened_at;
  if (status === 'paid') return { tone: 'success', text: 'Paid ✓' };
  if (opened) return { tone: 'warning', text: `Opened ${log.view_count || 1}×` };
  if (log.copy_count > 0) return { tone: 'neutral', text: `Copied ${log.copy_count}×` };
  return { tone: 'muted', text: 'Not opened' };
}

function copyAndLog(row) {
  const url = row.url || `https://portal.foundapay.com/pay/${row.token}`;
  navigator.clipboard.writeText(url);
  api.post(`/api/payment-links/${row.id}/copy-log`, { surface: 'list' }).catch(() => {});
  return url;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function PaymentLinks() {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const isClientUser = me?.role === 'client_user';
  const canSeeFee = ['super_admin', 'owner', 'admin', 'finance_manager'].includes(me?.role);
  const canEdit   = ['super_admin', 'owner', 'admin', 'finance_manager'].includes(me?.role);
  const canDelete = ['super_admin', 'owner'].includes(me?.role);

  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state (initialized from URL — makes deep links shareable)
  const [tab, setTab] = useState(searchParams.get('tab') || 'all');
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [clientFilter, setClientFilter] = useState(searchParams.get('client') || '');
  const [createdByFilter, setCreatedByFilter] = useState(searchParams.get('creator') || '');
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('from') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('to') || '');
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1', 10));

  // Push filter state into URL whenever it changes
  useEffect(() => {
    const next = new URLSearchParams();
    if (tab && tab !== 'all') next.set('tab', tab);
    if (q) next.set('q', q);
    if (clientFilter) next.set('client', clientFilter);
    if (createdByFilter) next.set('creator', createdByFilter);
    if (typeFilter) next.set('type', typeFilter);
    if (dateFrom) next.set('from', dateFrom);
    if (dateTo) next.set('to', dateTo);
    if (page > 1) next.set('page', String(page));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, clientFilter, createdByFilter, typeFilter, dateFrom, dateTo, page]);

  const [data, setData] = useState({ results: [], total: 0, summary: {} });
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [selected, setSelected] = useState(null);     // currently-open slide-over row
  const [qrModal, setQrModal] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try {
      let effectiveTab = tab;
      let effectiveType = typeFilter;
      if (tab === 'invoices') { effectiveTab = 'all'; effectiveType = 'invoice'; }
      if (tab === 'simple_links') { effectiveTab = 'all'; effectiveType = 'link'; }

      const params = new URLSearchParams();
      params.set('tab', effectiveTab);
      params.set('page', String(page));
      params.set('limit', '20');
      if (q) params.set('q', q);
      if (clientFilter) params.set('client_id', clientFilter);
      if (createdByFilter) params.set('created_by', createdByFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const [pl, c, u] = await Promise.all([
        api.get(`/api/payment-links?${params.toString()}`),
        clients.length ? Promise.resolve({ rows: clients }) : api.get('/api/clients').catch(() => ({ rows: [] })),
        users.length ? Promise.resolve({ rows: users })
                     : (isClientUser ? Promise.resolve({ rows: [] }) : api.get('/api/users').catch(() => ({ rows: [] }))),
      ]);
      let results = pl.results || pl.rows || [];
      if (effectiveType) results = results.filter((r) => (r.type || (r.invoice ? 'invoice' : 'link')) === effectiveType);
      setData({
        results,
        total: pl.total != null ? pl.total : results.length,
        summary: pl.summary || {},
      });
      if (!clients.length && c.rows) setClients(c.rows);
      if (!users.length && u.rows) setUsers(u.rows);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, page, q, clientFilter, createdByFilter, typeFilter, dateFrom, dateTo]);

  function resetFilters() {
    setTab('all'); setQ(''); setClientFilter(''); setCreatedByFilter('');
    setTypeFilter(''); setDateFrom(''); setDateTo(''); setPage(1);
  }

  async function resendEmail(row) {
    try {
      const r = await api.post(`/api/payment-links/${row.id}/resend-email`, {});
      toast.success(`Email sent to ${r.sent_to}`);
    } catch (e) { toast.error(e.message); }
  }
  async function doCancel(row) {
    try {
      await api.post(`/api/payment-links/${row.id}/cancel`, {});
      toast.success('Link cancelled');
      setCancelModal(null);
      // If the cancelled row is currently selected, refresh slide-over after reload
      load();
    } catch (e) { toast.error(e.message); }
  }

  const summary = data.summary || {};
  const totalPages = Math.max(1, Math.ceil(data.total / 20));
  const expiredCount = summary.expired_count ?? 0;
  const fpFee = canSeeFee ? (summary.total_fp_fee_earned || 0) : null;

  const activeFilterCount = [
    q, clientFilter, createdByFilter, typeFilter, dateFrom, dateTo,
  ].filter(Boolean).length + (tab !== 'all' ? 1 : 0);

  return (
    <div className="p-4 md:p-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Payment Requests"
        subtitle={`${summary.total_count ?? data.total} requests · ${summary.pending_count ?? 0} pending · ${summary.paid_count ?? 0} paid`}
        actions={canEdit && (
          <NewRequestDropdown
            open={newMenuOpen}
            setOpen={setNewMenuOpen}
            onPick={(kind) => {
              setNewMenuOpen(false);
              navigate('/virtual-terminal');
              if (kind === 'invoice') sessionStorage.setItem('vt_default_charge_type', 'invoice');
              else sessionStorage.setItem('vt_default_charge_type', 'link');
            }}
          />
        )}
      />

      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      {/* Stats — 5 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <StatCard label="Total" value={summary.total_count ?? data.total} />
        <StatCard label="Paid (volume)" value={money(summary.total_volume_paid || 0)} tone="success" />
        <StatCard label="Pending" value={summary.pending_count ?? 0} tone="warning" />
        <StatCard label="Expired" value={expiredCount} tone="muted" />
        {canSeeFee && <StatCard label="FP fee earned" value={money(fpFee)} tone="accent" />}
      </div>

      {/* Filter row 1 — status tabs (sticky) */}
      <Card className="p-2 mb-2" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const cnt = ({
              all:          summary.total_count,
              pending:      summary.pending_count,
              paid:         summary.paid_count,
              expired:      summary.expired_count,
              cancelled:    summary.cancelled_count,
              invoices:     summary.invoices_count,
              simple_links: summary.links_count,
            })[t.id];
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setPage(1); }}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none',
                  background: tab === t.id ? 'var(--bg-hover)' : 'transparent',
                  color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}
              >
                {t.label}
                {cnt != null && <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>· {cnt}</span>}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Filter row 2 — search + dropdowns */}
      <Card className="p-3 mb-3">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <div className="md:col-span-2 relative">
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <Input
              placeholder="Search invoice #, email, description…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              style={{ paddingLeft: 36 }}
            />
          </div>
          {!isClientUser && (
            <Select value={clientFilter} onChange={(e) => { setClientFilter(e.target.value); setPage(1); }}>
              <option value="">All clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          <Select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            <option value="invoice">🧾 Invoice</option>
            <option value="link">🔗 Link</option>
          </Select>
          {!isClientUser && (
            <Select value={createdByFilter} onChange={(e) => { setCreatedByFilter(e.target.value); setPage(1); }}>
              <option value="">All creators</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </Select>
          )}
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} title="From" />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} title="To" />
        </div>
        {activeFilterCount > 0 && (
          <div className="mt-2 flex items-center gap-3">
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} active
            </span>
            <button onClick={resetFilters} style={{
              fontSize: 12, color: 'var(--accent)', background: 'transparent',
              border: 'none', cursor: 'pointer', fontWeight: 500,
            }}>Clear filters</button>
          </div>
        )}
      </Card>

      {/* Mobile card list (md:hidden) */}
      <div className="md:hidden space-y-2">
        {loading && <Card className="p-4 text-center" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>}
        {!loading && data.results.length === 0 && (
          <Card className="p-6 text-center" style={{ color: 'var(--text-secondary)' }}>No payment requests yet</Card>
        )}
        {!loading && data.results.map((r) => (
          <MobileCard key={r.id} row={r} canSeeFee={canSeeFee} onOpen={() => setSelected(r)} />
        ))}
      </div>

      {/* Desktop table (hidden on mobile) */}
      <Card className="hidden md:block" style={{ overflow: 'visible' }}>
        <Table style={{ tableLayout: 'fixed', width: '100%' }}>
          <Thead>
            <Tr>
              <Th style={{ width: 80 }}>Type</Th>
              <Th style={{ width: 100 }}>Status</Th>
              <Th style={{ width: 100 }}>Created</Th>
              <Th style={{ width: 140 }}>Client</Th>
              <Th style={{ width: 160 }}>Customer</Th>
              <Th style={{ width: 90, textAlign: 'right' }}>Amount</Th>
              <Th>Description</Th>
              <Th style={{ width: 120 }}>Activity</Th>
              <Th style={{ width: 100 }}>Expires</Th>
              {canSeeFee && <Th style={{ width: 80, textAlign: 'right' }}>FP fee</Th>}
              <Th style={{ width: 60 }}>Tx</Th>
              <Th style={{ width: 50 }}></Th>
            </Tr>
          </Thead>
          <tbody>
            {loading && (
              <Tr><Td colSpan={canSeeFee ? 12 : 11} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</Td></Tr>
            )}
            {!loading && data.results.length === 0 && (
              <Tr><Td colSpan={canSeeFee ? 12 : 11} style={{ textAlign: 'center', padding: '32px 16px' }}>
                <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
                  {tab === 'all' && !typeFilter ? 'No payment requests yet' : 'No matches'}
                </div>
              </Td></Tr>
            )}
            {!loading && data.results.map((r) => (
              <PaymentRow
                key={r.id}
                row={r}
                isSelected={selected?.id === r.id}
                isClientUser={isClientUser}
                canSeeFee={canSeeFee}
                canEdit={canEdit}
                canDelete={canDelete}
                onSelect={() => setSelected(r)}
                onCopyUrl={() => { copyAndLog(r); toast.success('Link copied'); }}
                onShowQr={() => setQrModal(r)}
                onOpenPage={() => window.open(r.url || `https://portal.foundapay.com/pay/${r.token}`, '_blank')}
                onResendEmail={() => resendEmail(r)}
                onCancel={() => setCancelModal(r)}
              />
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Page {page} of {totalPages} · {data.total} total
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Right-side detail slide-over */}
      <PaymentDetailSlideOver
        row={selected}
        onClose={() => setSelected(null)}
        canSeeFee={canSeeFee}
        canEdit={canEdit}
        onCopyUrl={() => { if (selected) { copyAndLog(selected); toast.success('Link copied'); } }}
        onShowQr={() => selected && setQrModal(selected)}
        onResendEmail={() => selected && resendEmail(selected)}
        onCancel={() => selected && setCancelModal(selected)}
      />

      {qrModal && <QrModal row={qrModal} onClose={() => setQrModal(null)} />}
      {cancelModal && (
        <CancelModal row={cancelModal} onClose={() => setCancelModal(null)} onConfirm={() => doCancel(cancelModal)} />
      )}
    </div>
  );
}

// ━━━ "+ New" button with dropdown ──────────────────────────────
function NewRequestDropdown({ open, setOpen, onPick }) {
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, setOpen]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Button onClick={() => setOpen((o) => !o)}>
        <Plus size={14} /> New <ChevronDown size={12} />
      </Button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 240, padding: 4, zIndex: 50,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
        }}>
          <DropItem icon={LinkIcon} onClick={() => onPick('link')} title="Simple Payment Link" sub="Just an amount + customer" />
          <DropItem icon={FileSpreadsheet} onClick={() => onPick('invoice')} title="Invoice" sub="Line items + due date" />
        </div>
      )}
    </div>
  );
}
function DropItem({ icon: Icon, title, sub, onClick }) {
  return (
    <button onClick={onClick}
      style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
        padding: '10px 12px', cursor: 'pointer', borderRadius: 6, display: 'flex', gap: 10, alignItems: 'flex-start' }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <Icon size={16} style={{ marginTop: 2, color: 'var(--accent)' }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{sub}</div>
      </div>
    </button>
  );
}

// ━━━ StatCard ─────────────────────────────────────────────
function StatCard({ label, value, tone }) {
  const colors = {
    success: 'var(--success)',
    warning: 'var(--warning)',
    accent: 'var(--accent)',
    muted: 'var(--text-tertiary)',
  };
  return (
    <Card className="p-4">
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: colors[tone] || 'var(--text-primary)' }}>
        {value}
      </div>
    </Card>
  );
}

// ━━━ Mobile card list row ─────────────────────────────────
function MobileCard({ row, canSeeFee, onOpen }) {
  const sd = statusDisplay(row.status);
  const isInvoice = row.type === 'invoice' || !!row.invoice;
  const act = activitySummary(row);
  return (
    <Card className="p-3" onClick={onOpen} style={{ cursor: 'pointer' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <div className="flex items-center gap-2">
          {isInvoice
            ? <Badge tone="accent">🧾 Invoice</Badge>
            : <Badge tone="info">🔗 Link</Badge>}
          <Badge tone={sd.tone}>{sd.label}</Badge>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{money(row.amount)}</div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
        {row.client?.name || '—'} · {row.customer_name || row.customer_email || '—'}
      </div>
      {(isInvoice && row.invoice?.invoice_number) && (
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {row.invoice.invoice_number}
        </div>
      )}
      <div className="flex items-center justify-between" style={{ marginTop: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>
        <span>{act.text}</span>
        <span>{relativeTime(row.created_at)}</span>
      </div>
    </Card>
  );
}

// ━━━ Desktop table row ─────────────────────────────────────
function PaymentRow({ row, isSelected, canSeeFee, canEdit, canDelete,
                     onSelect, onCopyUrl, onShowQr, onOpenPage, onResendEmail, onCancel }) {
  const sd = statusDisplay(row.status);
  const expires = row.status === 'paid' ? '—' : (row.expires_at ? relativeTime(row.expires_at) : '—');
  const isInvoice = row.type === 'invoice' || !!row.invoice;
  const act = activitySummary(row);

  return (
    <Tr
      onClick={onSelect}
      style={{
        cursor: 'pointer',
        background: isSelected ? 'var(--bg-hover)' : undefined,
        borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
        transition: 'background 120ms',
      }}
    >
      <Td style={{ width: 80 }}>
        {isInvoice
          ? <Badge tone="accent">🧾 Invoice</Badge>
          : <Badge tone="info">🔗 Link</Badge>}
      </Td>
      <Td style={{ width: 100 }}><Badge tone={sd.tone}>{sd.label}</Badge></Td>
      <Td style={{ width: 100, fontSize: 12 }} title={row.created_at}>{relativeTime(row.created_at)}</Td>
      <Td style={{ width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.client?.name || '—'}</Td>
      <Td style={{ width: 160, overflow: 'hidden' }}>
        {row.customer_email || row.customer_name ? (
          <div style={{ fontSize: 12, lineHeight: 1.3 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer_name || '—'}</div>
            {row.customer_email && (
              <div style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.customer_email}
              </div>
            )}
          </div>
        ) : '—'}
      </Td>
      <Td style={{ width: 90, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{money(row.amount)}</Td>
      <Td title={row.description} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isInvoice && row.invoice?.invoice_number
          ? <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{row.invoice.invoice_number}</span>
          : (row.description || '—')}
      </Td>
      <Td style={{ width: 120 }}><ActivityCell summary={act} /></Td>
      <Td style={{ width: 100, fontSize: 11, color: 'var(--text-tertiary)' }}>{expires}</Td>
      {canSeeFee && (
        <Td style={{ width: 80, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
          {row.fp_fee != null ? money(row.fp_fee) : '—'}
        </Td>
      )}
      <Td style={{ width: 60 }}>
        {row.transaction?.id ? (
          <a href={`/transactions?tx=${row.transaction.id}`} style={{ color: 'var(--accent)', fontSize: 12 }} onClick={(e) => e.stopPropagation()}>
            #{row.transaction.id}
          </a>
        ) : '—'}
      </Td>
      <Td style={{ width: 50 }} onClick={(e) => e.stopPropagation()}>
        <KebabMenu
          row={row}
          canEdit={canEdit}
          canDelete={canDelete}
          onCopyUrl={onCopyUrl}
          onShowQr={onShowQr}
          onOpenPage={onOpenPage}
          onResendEmail={onResendEmail}
          onCancel={onCancel}
        />
      </Td>
    </Tr>
  );
}

function ActivityCell({ summary }) {
  const color = ({
    success: 'var(--success)',
    warning: 'var(--warning)',
    neutral: 'var(--text-secondary)',
    muted: 'var(--text-tertiary)',
  })[summary.tone];
  return (
    <div style={{ fontSize: 12, color, fontWeight: summary.tone === 'success' ? 600 : 400 }}>
      {summary.text}
    </div>
  );
}

// ━━━ Slide-over: full payment-request detail ──────────────
function PaymentDetailSlideOver({ row, onClose, canSeeFee, canEdit, onCopyUrl, onShowQr, onResendEmail, onCancel }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (!row) { setDetail(null); return; }
    setDetail(null);
    api.get(`/api/payment-links/${row.id}`).then(setDetail).catch(() => setDetail({ link: row, timeline: [] }));
  }, [row?.id]);

  if (!row) return null;
  const link = detail?.link || row;
  const tl = detail?.timeline || [];
  const url = link.url || `https://portal.foundapay.com/pay/${link.token}`;
  const isInvoice = link.type === 'invoice' || !!link.invoice;
  const inv = link.invoice;
  let lineItems = inv?.line_items || [];
  if (typeof lineItems === 'string') {
    try { lineItems = JSON.parse(lineItems); } catch { lineItems = []; }
  }
  const sd = statusDisplay(link.status);
  const isPending = !['paid', 'cancelled', 'failed', 'refunded', 'expired'].includes(link.status);
  const headerLabel = isInvoice
    ? (inv?.invoice_number || link.invoice_number || `#${String(link.id).slice(0, 8)}`)
    : (`Link · ${String(link.token || link.id).slice(0, 8)}…`);

  return (
    <SlideOver
      open
      onClose={onClose}
      title={headerLabel}
      badge={<Badge tone={sd.tone}>{sd.label}</Badge>}
      width={420}
    >
      <div className="px-5 py-4" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* SECTION 1 — Payment URL + QR */}
        <div>
          <SectionLabel>Payment URL</SectionLabel>
          <div title={url} style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 11, color: 'var(--text-secondary)',
            background: 'var(--bg-primary)', padding: '8px 10px', borderRadius: 8,
            border: '1px solid var(--border)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8,
          }}>{url}</div>
          <div className="flex gap-2 flex-wrap" style={{ marginBottom: 10 }}>
            <Button variant="secondary" size="sm" onClick={onCopyUrl}><Copy size={12} /> Copy</Button>
            <Button variant="secondary" size="sm" onClick={() => window.open(url, '_blank')}><ExternalLink size={12} /> Open</Button>
            <Button variant="secondary" size="sm" onClick={onShowQr}><QrCode size={12} /> QR</Button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img
              src={`/api/payment-links/${link.id}/qr.png`}
              alt="QR"
              style={{ width: 120, height: 120, borderRadius: 8, border: '1px solid var(--border)', background: 'white' }}
            />
            <a
              href={`/api/payment-links/${link.id}/qr.png`}
              download={`qr-${link.invoice_number || link.id}.png`}
              style={{ fontSize: 12, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Download size={12} /> Download QR
            </a>
          </div>
        </div>

        {/* SECTION 2 — Details */}
        <div>
          <SectionLabel>Details</SectionLabel>
          <DetailRow label="Type" value={isInvoice ? 'Invoice' : 'Simple Link'} />
          <DetailRow label="Client" value={link.client?.name || '—'} />
          <DetailRow label="Customer"
            value={link.customer_name || link.customer_email
              ? <span>{link.customer_name || ''}{link.customer_email && <span style={{ color: 'var(--text-tertiary)' }}> · {link.customer_email}</span>}</span>
              : '—'} />
          <DetailRow label="Amount" value={<span style={{ fontSize: 16, fontWeight: 700 }}>{money(link.amount)}</span>} />
          {canSeeFee && link.fp_fee != null && (
            <>
              <DetailRow label="FP fee" value={money(link.fp_fee)} />
              <DetailRow label="Net to client" value={money((parseFloat(link.amount) || 0) - (parseFloat(link.fp_fee) || 0))} />
            </>
          )}
          <DetailRow label="Created" value={
            <span>
              {new Date(link.created_at).toLocaleString()}
              {link.created_by_user?.name && <span style={{ color: 'var(--text-tertiary)' }}> · {link.created_by_user.name}</span>}
            </span>
          } />
          <DetailRow
            label="Expires"
            value={link.status === 'paid'
              ? <span style={{ color: 'var(--success)' }}>Paid</span>
              : (link.expires_at ? new Date(link.expires_at).toLocaleString() : '—')}
          />
        </div>

        {/* SECTION 3 — Invoice Details */}
        {isInvoice && inv && (
          <div>
            <SectionLabel>Invoice details</SectionLabel>
            <DetailRow label="Invoice #" value={<span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--accent)' }}>{inv.invoice_number}</span>} />
            {inv.due_date && <DetailRow label="Due date" value={dateOnly(inv.due_date)} />}
            {lineItems.length > 0 && (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8 }}>
                <thead>
                  <tr style={{ color: 'var(--text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <th style={{ padding: '6px 6px', textAlign: 'left', fontWeight: 600 }}>Description</th>
                    <th style={{ padding: '6px 6px', textAlign: 'right', width: 36, fontWeight: 600 }}>Qty</th>
                    <th style={{ padding: '6px 6px', textAlign: 'right', width: 80, fontWeight: 600 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px', color: 'var(--text-primary)' }}>{li.description}</td>
                      <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--text-secondary)' }}>{li.quantity}</td>
                      <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)' }}>{money(li.line_total)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px', fontWeight: 600 }}>Total</td>
                    <td></td>
                    <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{money(inv.total_amount)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* SECTION 4 — Activity timeline */}
        <div>
          <SectionLabel>Activity timeline</SectionLabel>
          {tl.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No events recorded yet.</div>}
          {tl.length > 0 && (
            <div style={{ position: 'relative', paddingLeft: 14 }}>
              <div style={{ position: 'absolute', left: 5, top: 4, bottom: 4, width: 2, background: 'var(--border)', borderRadius: 1 }} />
              {tl.map((e, i) => <TimelineRow key={e.id} ev={e} isLast={i === tl.length - 1} />)}
            </div>
          )}
        </div>

        {/* SECTION 5 — Actions */}
        <div>
          <SectionLabel>Actions</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {link.customer_email && (
              <Button variant="secondary" size="sm" onClick={onResendEmail}><Mail size={12} /> Resend Email</Button>
            )}
            {canEdit && isPending && (
              <Button variant="danger" size="sm" onClick={onCancel}><XCircle size={12} /> Cancel</Button>
            )}
            {link.transaction?.id && (
              <a href={`/transactions?tx=${link.transaction.id}`}>
                <Button variant="secondary" size="sm"><Eye size={12} /> View Transaction</Button>
              </a>
            )}
            {isInvoice && inv?.id && (
              <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm"><Download size={12} /> Invoice PDF</Button>
              </a>
            )}
          </div>
        </div>
      </div>
    </SlideOver>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
      color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 8,
    }}>{children}</div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8,
      fontSize: 13, padding: '4px 0',
    }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

const TIMELINE_LOOKUP = {
  'payment_link.created':                 { icon: '🔗', label: 'Link created',         color: 'var(--accent)' },
  'payment_link.copied':                  { icon: '📋', label: 'Link copied',          color: 'var(--info)' },
  'payment_link.viewed':                  { icon: '👁',  label: 'Opened',               color: 'var(--warning)' },
  'payment_link.charge_attempted':        { icon: '💳', label: 'Payment attempted',    color: 'var(--warning)' },
  'payment_link.charge_succeeded':        { icon: '✅', label: 'Paid',                 color: 'var(--success)' },
  'payment_link.charge_declined':         { icon: '❌', label: 'Payment declined',     color: 'var(--danger)' },
  'payment_link.charge_db_write_failed':  { icon: '⚠️', label: 'DB write failed',      color: 'var(--danger)' },
  'payment_link.cancelled':               { icon: '✕',  label: 'Cancelled',            color: 'var(--danger)' },
  'payment_link.email_sent':              { icon: '📧', label: 'Email sent',           color: 'var(--info)' },
  'invoice.sent':                         { icon: '📧', label: 'Invoice emailed',      color: 'var(--info)' },
  'invoice.created':                      { icon: '🧾', label: 'Invoice created',      color: 'var(--accent)' },
};

function TimelineRow({ ev, isLast }) {
  const meta = (() => {
    if (!ev.metadata) return null;
    if (typeof ev.metadata === 'string') {
      try { return JSON.parse(ev.metadata); } catch { return null; }
    }
    return ev.metadata;
  })();
  const cfg = TIMELINE_LOOKUP[ev.action] || { icon: '•', label: ev.action, color: 'var(--text-tertiary)' };
  const detail = [];
  if (meta?.device) detail.push(meta.device);
  if (meta?.ip || ev.ip) detail.push(meta?.ip || ev.ip);
  if (meta?.code) detail.push(meta.code);
  if (meta?.message && ev.action.includes('decline')) detail.push(meta.message);

  return (
    <div style={{ position: 'relative', paddingBottom: isLast ? 0 : 12, paddingLeft: 16 }}>
      <div style={{
        position: 'absolute', left: -10, top: 4,
        width: 12, height: 12, borderRadius: '50%',
        background: cfg.color,
        boxShadow: '0 0 0 3px var(--bg-secondary)',
      }} />
      <div style={{ fontSize: 13, lineHeight: 1.3 }}>
        <span style={{ fontSize: 13 }}>{cfg.icon}</span>{' '}
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{cfg.label}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
        {new Date(ev.at).toLocaleString()}
        {ev.actor?.name && <> · {ev.actor.name}</>}
        {detail.length > 0 && <> · {detail.join(' · ')}</>}
      </div>
    </div>
  );
}

// ━━━ Kebab menu ───────────────────────────────────────────
function KebabMenu({ row, canEdit, canDelete, onCopyUrl, onShowQr, onOpenPage, onResendEmail, onCancel }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    function place() {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuH = menuRef.current?.offsetHeight || 240;
      const menuW = 220;
      const gap = 6;
      let top = rect.bottom + gap;
      if (top + menuH > window.innerHeight - 12) top = Math.max(12, rect.top - menuH - gap);
      let left = rect.right - menuW;
      if (left < 12) left = 12;
      if (left + menuW > window.innerWidth - 12) left = window.innerWidth - menuW - 12;
      setPos({ top, left });
    }
    place();
    const raf = requestAnimationFrame(place);
    function close() { setOpen(false); }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', close, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  useEffect(() => {
    function onDocClick(e) {
      if (btnRef.current && !btnRef.current.contains(e.target) &&
          menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isPending = !['paid', 'cancelled', 'failed', 'refunded', 'expired'].includes(row.status);
  const isInvoice = row.type === 'invoice' || !!row.invoice;

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="Actions"
        style={{
          background: open ? 'var(--bg-hover)' : 'transparent',
          border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6,
          color: 'var(--text-secondary)', display: 'inline-flex',
        }}
      >
        <MoreVertical size={16} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="fp-slide-up" role="menu" style={{
          position: 'fixed',
          top: pos?.top ?? -9999, left: pos?.left ?? -9999,
          width: 220, padding: 4, zIndex: 1000,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          visibility: pos ? 'visible' : 'hidden',
        }}>
          <MenuItem icon={Copy} onClick={() => { setOpen(false); onCopyUrl(); }}>Copy link</MenuItem>
          <MenuItem icon={QrCode} onClick={() => { setOpen(false); onShowQr(); }}>Show QR code</MenuItem>
          <MenuItem icon={ExternalLink} onClick={() => { setOpen(false); onOpenPage(); }}>Open page</MenuItem>
          {row.customer_email && (
            <MenuItem icon={Mail} onClick={() => { setOpen(false); onResendEmail(); }}>Resend email</MenuItem>
          )}
          {isInvoice && row.invoice?.id && (
            <MenuItem icon={Eye} onClick={() => {
              setOpen(false);
              const a = document.createElement('a');
              a.href = `/api/invoices/${row.invoice.id}/pdf`;
              a.target = '_blank';
              a.click();
            }}>Download invoice PDF</MenuItem>
          )}
          {canEdit && isPending && (
            <>
              <MenuDivider />
              <MenuItem icon={XCircle} tone="danger" onClick={() => { setOpen(false); onCancel(); }}>Cancel link</MenuItem>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function MenuItem({ icon: Icon, onClick, children, tone, disabled }) {
  const colors = { warning: 'var(--warning)', success: 'var(--success)', danger: 'var(--danger)' };
  const color = disabled ? 'var(--text-tertiary)' : (colors[tone] || 'var(--text-primary)');
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '8px 10px', background: 'transparent', border: 'none',
        color, fontSize: 13, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1, textAlign: 'left', borderRadius: 6,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={14} /> {children}
    </button>
  );
}
function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />;
}

// ━━━ QR + Cancel modals ────────────────────────────────────
function QrModal({ row, onClose }) {
  return (
    <Modal open onClose={onClose} title={`QR — ${row.invoice?.invoice_number || row.description || row.id?.slice(0, 8)}`}
      footer={<Button onClick={onClose}>Close</Button>}>
      <div className="text-center">
        <img
          src={`/api/payment-links/${row.id}/qr.png`}
          alt="QR"
          style={{ width: 280, height: 280, borderRadius: 10, border: '1px solid var(--border)' }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 12, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
          {row.url || `https://portal.foundapay.com/pay/${row.token}`}
        </div>
      </div>
    </Modal>
  );
}

function CancelModal({ row, onClose, onConfirm }) {
  return (
    <Modal open onClose={onClose} title="Cancel payment link?"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Keep</Button>
        <Button variant="danger" onClick={onConfirm}>Cancel link</Button>
      </>}>
      <p style={{ fontSize: 14 }}>
        This payment link for <strong>{money(row.amount)}</strong>
        {row.customer_email && <> to <strong>{row.customer_email}</strong></>}
        {' '}will be cancelled. The customer will see a "Link cancelled" page if they reopen it.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
        This is reversible only by re-creating a new link.
      </p>
    </Modal>
  );
}
