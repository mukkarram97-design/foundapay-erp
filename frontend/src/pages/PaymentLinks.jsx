// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Unified "Payment Requests" page — covers both simple links AND invoices.
// Source of truth: payment_link_requests; invoices joined by invoice_number.
// row.type = 'invoice' when joined; 'link' otherwise.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreVertical, Copy, ExternalLink, QrCode, Mail, Eye, Edit2, XCircle, Plus, Search, X,
  Link as LinkIcon, FileSpreadsheet, ChevronDown, ChevronRight, Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';

const TABS = [
  { id: 'all',         label: 'All' },
  { id: 'pending',     label: 'Pending' },
  { id: 'paid',        label: 'Paid' },
  { id: 'expired',     label: 'Expired' },
  { id: 'cancelled',   label: 'Cancelled' },
  { id: 'invoices',    label: 'Invoices' },
  { id: 'simple_links', label: 'Simple Links' },
];

// status → display label + tone. link_generated/requested → "Pending"
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

// Activity column summary — color-coded by latest engagement
function activitySummary(row) {
  const log = row.access_log || {};
  const status = row.status;
  const opened = log.view_count > 0 || !!log.first_opened_at;
  const copied = log.copy_count > 0;
  if (status === 'paid') {
    return {
      tone: 'success',
      lines: [
        opened ? `Opened ${log.view_count || 1}×` : 'Paid',
        log.first_opened_at && row.paid_at
          ? `Paid ${relativeTime(row.paid_at)}`
          : `Paid ${relativeTime(row.paid_at || row.created_at)}`,
      ],
    };
  }
  if (opened) {
    return {
      tone: 'warning',
      lines: [
        `${copied ? 'Sent • ' : ''}Opened ${log.view_count || 1}×`,
        `Last: ${relativeTime(log.viewed_at || log.first_opened_at)}`,
      ],
    };
  }
  if (copied) {
    return { tone: 'neutral', lines: [`Copied ${log.copy_count}×`, `Not opened yet`] };
  }
  return { tone: 'muted', lines: ['Not opened yet'] };
}

// Copy + log helper. Errors are silent — copy is the user-visible action.
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

  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [createdByFilter, setCreatedByFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState(''); // '' | 'invoice' | 'link'
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ results: [], total: 0, summary: {} });
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [expanded, setExpanded] = useState(null);   // currently-expanded row id
  const [qrModal, setQrModal] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try {
      // Effective tab: drop the type-only tabs (invoices/simple_links) into the
      // typeFilter knob so backend tab='all' is used and the type LEFT JOIN drives the rest.
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
      load();
    } catch (e) { toast.error(e.message); }
  }

  const summary = data.summary || {};
  const totalPages = Math.max(1, Math.ceil(data.total / 20));
  const expiredCount = summary.expired_count ?? 0;
  const fpFee = canSeeFee ? (summary.total_fp_fee_earned || 0) : null;

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Payment Requests"
        subtitle={`${summary.total_count ?? data.total} requests · ${summary.pending_count ?? 0} pending · ${summary.paid_count ?? 0} paid`}
        actions={canEdit && (
          <NewRequestDropdown
            open={newMenuOpen}
            setOpen={setNewMenuOpen}
            onPick={(kind) => {
              setNewMenuOpen(false);
              navigate('/virtual-terminal'); // VT has both Payment Link and Invoice tabs
              setTimeout(() => {
                // Hint via window.history state so VT can preselect the tab if it ever reads it.
                // (No-op if VT doesn't read it.)
              }, 0);
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

      {/* Tabs */}
      <Card className="p-2 mb-3">
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

      {/* Filters */}
      <Card className="p-3 mb-3">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <div className="md:col-span-2 relative">
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <Input
              placeholder="Search invoice #, description, email…"
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
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </div>
        {(q || clientFilter || createdByFilter || typeFilter || dateFrom || dateTo || tab !== 'all') && (
          <div className="mt-2">
            <button onClick={resetFilters} style={{
              fontSize: 12, color: 'var(--accent)', background: 'transparent',
              border: 'none', cursor: 'pointer',
            }}>Reset filters</button>
          </div>
        )}
      </Card>

      {/* Table */}
      <Card style={{ overflow: 'visible' }}>
        <Table>
          <Thead>
            <Tr>
              <Th style={{ width: 28 }}></Th>
              <Th style={{ width: 80 }}>Type</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th>Client</Th>
              <Th>Customer</Th>
              <Th className="text-right">Amount</Th>
              <Th>Description</Th>
              <Th>Activity</Th>
              <Th>Expires</Th>
              {canSeeFee && <Th className="text-right">FP fee</Th>}
              <Th>Tx</Th>
              <Th style={{ width: 56 }}></Th>
            </Tr>
          </Thead>
          <tbody>
            {loading && (
              <Tr><Td colSpan={canSeeFee ? 13 : 12} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</Td></Tr>
            )}
            {!loading && data.results.length === 0 && (
              <Tr><Td colSpan={canSeeFee ? 13 : 12} style={{ textAlign: 'center', padding: '32px 16px' }}>
                <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
                  {tab === 'all' && !typeFilter ? 'No payment requests yet' : 'No matches'}
                </div>
              </Td></Tr>
            )}
            {!loading && data.results.map((r) => (
              <PaymentRow
                key={r.id}
                row={r}
                isClientUser={isClientUser}
                canSeeFee={canSeeFee}
                canEdit={canEdit}
                canDelete={canDelete}
                expanded={expanded === r.id}
                onToggle={() => setExpanded((id) => id === r.id ? null : r.id)}
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

// ━━━ Row + expansion ─────────────────────────────────────────
function PaymentRow({ row, isClientUser, canSeeFee, canEdit, canDelete, expanded, onToggle,
                     onCopyUrl, onShowQr, onOpenPage, onResendEmail, onCancel }) {
  const sd = statusDisplay(row.status);
  const expires = row.status === 'paid'
    ? '—'
    : (row.expires_at ? relativeTime(row.expires_at) : '—');
  const isInvoice = row.type === 'invoice' || !!row.invoice;
  const act = activitySummary(row);
  const colSpan = canSeeFee ? 13 : 12;

  return (
    <>
      <Tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <Td style={{ width: 28 }}>
          {expanded
            ? <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} />
            : <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
          }
        </Td>
        <Td>
          {isInvoice
            ? <Badge tone="accent">🧾 Invoice</Badge>
            : <Badge tone="info">🔗 Link</Badge>
          }
        </Td>
        <Td><Badge tone={sd.tone}>{sd.label}</Badge></Td>
        <Td title={row.created_at}>{relativeTime(row.created_at)}</Td>
        <Td>{row.client?.name || '—'}</Td>
        <Td>
          {row.customer_email || row.customer_name ? (
            <div style={{ fontSize: 12 }}>
              <div>{row.customer_name || '—'}</div>
              {row.customer_email && <div style={{ color: 'var(--text-tertiary)' }}>{row.customer_email}</div>}
            </div>
          ) : '—'}
        </Td>
        <Td className="text-right font-mono">{money(row.amount)}</Td>
        <Td title={row.description} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isInvoice && row.invoice?.invoice_number
            ? <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{row.invoice.invoice_number}</span>
            : (row.description || '—')}
        </Td>
        <Td>
          <ActivityCell summary={act} />
        </Td>
        <Td className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{expires}</Td>
        {canSeeFee && <Td className="text-right font-mono">{row.fp_fee != null ? money(row.fp_fee) : '—'}</Td>}
        <Td>
          {row.transaction?.id ? (
            <a href={`/transactions?tx=${row.transaction.id}`} style={{ color: 'var(--accent)', fontSize: 12 }} onClick={(e) => e.stopPropagation()}>
              #{row.transaction.id}
            </a>
          ) : '—'}
        </Td>
        <Td onClick={(e) => e.stopPropagation()}>
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
      {expanded && (
        <Tr style={{ background: 'var(--bg-tertiary)' }}>
          <Td colSpan={colSpan} style={{ padding: 0 }}>
            <ExpandedView row={row} canSeeFee={canSeeFee} onCopyUrl={onCopyUrl} onShowQr={onShowQr} />
          </Td>
        </Tr>
      )}
    </>
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
    <div style={{ fontSize: 11, lineHeight: 1.4, color, fontWeight: summary.tone === 'success' ? 600 : 400 }}>
      {summary.lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

// ━━━ Expanded inline view ─────────────────────────────────
function ExpandedView({ row, canSeeFee, onCopyUrl, onShowQr }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    api.get(`/api/payment-links/${row.id}`).then(setDetail).catch(() => setDetail({ link: row, timeline: [] }));
  }, [row.id]);
  const link = detail?.link || row;
  const tl = detail?.timeline || [];
  const url = link.url || `https://portal.foundapay.com/pay/${link.token}`;
  const isInvoice = link.type === 'invoice' || !!link.invoice;
  const inv = link.invoice;
  let lineItems = inv?.line_items || [];
  if (typeof lineItems === 'string') {
    try { lineItems = JSON.parse(lineItems); } catch { lineItems = []; }
  }

  return (
    <div style={{
      padding: 24,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: 20,
      background: 'var(--bg-tertiary)',
    }}>

      {/* LEFT — URL + actions + invoice details */}
      <div style={{ minWidth: 0 }}>
        <Card className="p-4 mb-3" style={{ background: 'var(--bg-secondary)' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 600 }}>Public URL</div>
          <div title={url} style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 11,
            color: 'var(--text-secondary)',
            background: 'var(--bg-primary)',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 10,
          }}>{url}</div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={onCopyUrl}><Copy size={12} /> Copy</Button>
            <Button variant="secondary" size="sm" onClick={() => window.open(url, '_blank')}><ExternalLink size={12} /> Open</Button>
            <Button variant="secondary" size="sm" onClick={onShowQr}><QrCode size={12} /> QR</Button>
          </div>
        </Card>

        {isInvoice && inv && (
          <Card className="p-4" style={{ background: 'var(--bg-secondary)' }}>
            <div className="flex items-baseline justify-between mb-2">
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', fontWeight: 600 }}>Invoice</div>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{inv.invoice_number}</div>
            </div>

            {(link.customer_name || link.customer_email) && (
              <div style={{ marginBottom: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.06em', marginBottom: 2 }}>Bill to</div>
                {link.customer_name && <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{link.customer_name}</div>}
                {link.customer_email && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{link.customer_email}</div>}
              </div>
            )}

            {lineItems.length > 0 && (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 10 }}>
                <thead>
                  <tr style={{ color: 'var(--text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>Description</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', width: 50, fontWeight: 600 }}>Qty</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', width: 90, fontWeight: 600 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px', color: 'var(--text-primary)' }}>{li.description}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--text-secondary)' }}>{li.quantity}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)' }}>{money(li.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <Row label="Subtotal" value={money(inv.subtotal)} />
              {parseFloat(inv.discount_amount) > 0 && <Row label="Discount" value={`-${money(inv.discount_amount)}`} />}
              {parseFloat(inv.tax_rate) > 0 && (
                <Row label={`Tax (${(parseFloat(inv.tax_rate) * 100).toFixed(2)}%)`} value={money(inv.tax_amount)} />
              )}
              <Row label="Total" value={money(inv.total_amount)} bold />
            </div>

            {inv.due_date && (
              <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--accent-dim)', borderRadius: 8, fontSize: 12, color: 'var(--accent)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>Due date</span>
                <span>{dateOnly(inv.due_date)}</span>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* RIGHT — timeline */}
      <div style={{ minWidth: 0 }}>
        <Card className="p-4" style={{ background: 'var(--bg-secondary)' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 12 }}>Activity timeline</div>
          {tl.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No events recorded yet.</div>}
          {tl.length > 0 && (
            <div style={{ position: 'relative', paddingLeft: 14 }}>
              <div style={{ position: 'absolute', left: 5, top: 4, bottom: 4, width: 2, background: 'var(--border)', borderRadius: 1 }} />
              {tl.map((e, i) => <TimelineRow key={e.id} ev={e} isLast={i === tl.length - 1} />)}
            </div>
          )}

          {canSeeFee && link.status === 'paid' && (
            <div style={{ marginTop: 14, padding: 12, background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>Settlement</div>
              <Row label="Gross" value={money(link.amount)} />
              <Row label="FP fee" value={money(link.fp_fee || 0)} />
              <Row label="Net to client" value={money((parseFloat(link.amount) || 0) - (parseFloat(link.fp_fee) || 0))} bold />
              {link.transaction?.id && (
                <Row label="Transaction" value={<a href={`/transactions?tx=${link.transaction.id}`} style={{ color: 'var(--accent)' }}>#{link.transaction.id}</a>} />
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// Per-action icon + label + dot color for the timeline
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
      {/* Dot */}
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

function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontWeight: bold ? 600 : 400 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{value}</span>
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
        onClick={() => setOpen((o) => !o)}
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
