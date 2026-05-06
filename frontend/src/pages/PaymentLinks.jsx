import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreVertical, Copy, ExternalLink, QrCode, Mail, Eye, Edit2, XCircle, Plus, Search, X,
} from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';

const TABS = [
  { id: 'all',       label: 'All' },
  { id: 'pending',   label: 'Pending' },
  { id: 'paid',      label: 'Paid' },
  { id: 'expired',   label: 'Expired' },
  { id: 'cancelled', label: 'Cancelled' },
];

const STATUS_TONE = {
  paid: 'success',
  cancelled: 'danger',
  failed: 'danger',
  refunded: 'danger',
  expired: 'neutral',
  pending: 'warning',
  link_generated: 'info',
  requested: 'info',
  assigned: 'info',
  merchant_selected: 'info',
  sent_to_client: 'info',
  sent_to_customer: 'info',
  waiting_payment: 'warning',
};

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

export default function PaymentLinks() {
  const { user: me } = useAuth();
  const isClientUser = me?.role === 'client_user';
  const canSeeFee = ['super_admin', 'owner', 'admin', 'finance_manager'].includes(me?.role);
  const canEdit   = ['super_admin', 'owner', 'admin', 'finance_manager'].includes(me?.role);

  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ results: [], total: 0, summary: {} });
  const [clients, setClients] = useState([]);
  const [entities, setEntities] = useState([]);
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [openDetail, setOpenDetail] = useState(null);
  const [qrModal, setQrModal] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const params = new URLSearchParams();
      params.set('tab', tab);
      params.set('page', String(page));
      params.set('limit', '20');
      if (q) params.set('q', q);
      if (clientFilter) params.set('client_id', clientFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const [pl, c, e, m] = await Promise.all([
        api.get(`/api/payment-links?${params.toString()}`),
        clients.length ? Promise.resolve({ rows: clients }) : api.get('/api/clients'),
        entities.length ? Promise.resolve({ rows: entities }) : api.get('/api/entities'),
        merchants.length ? Promise.resolve({ rows: merchants }) : api.get('/api/merchants'),
      ]);
      // Enhanced shape: { results, total, page, limit, summary }
      // Legacy shape:    { rows: [...] }
      if (pl.results) setData(pl);
      else setData({ results: pl.rows || [], total: (pl.rows || []).length, summary: {} });
      if (!clients.length) setClients(c.rows);
      if (!entities.length) setEntities(e.rows);
      if (!merchants.length) setMerchants(m.rows);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, page, q, clientFilter, dateFrom, dateTo]);

  function resetFilters() {
    setTab('all'); setQ(''); setClientFilter(''); setDateFrom(''); setDateTo(''); setPage(1);
  }

  function copyUrl(row) {
    const url = row.url || `https://portal.foundapay.com/pay/${row.token}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
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

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Payment Links"
        subtitle={`${summary.total_count ?? data.total} links · ${summary.pending_count ?? 0} pending · ${summary.paid_this_month ?? 0} paid this month`}
        actions={canEdit && <Button onClick={() => setCreateOpen(true)}><Plus size={14} /> New link</Button>}
      />

      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label="Total" value={summary.total_count ?? data.total} />
        <StatCard label="Paid (volume)" value={money(summary.total_volume_paid || 0)} tone="success" />
        <StatCard label="Pending" value={summary.pending_count ?? 0} tone="warning" />
        {canSeeFee && (
          <StatCard label="FP fee earned" value={money(summary.total_fp_fee_earned || 0)} tone="accent" />
        )}
      </div>

      {/* Tabs */}
      <Card className="p-2 mb-3">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
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
              {tab === t.id && summary[`${t.id}_count`] != null && (
                <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>
                  · {summary[`${t.id}_count`]}
                </span>
              )}
            </button>
          ))}
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-3 mb-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <div className="md:col-span-2 relative">
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <Input
              placeholder="Search token, description, customer email or name…"
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
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} placeholder="From" />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} placeholder="To" />
        </div>
        {(q || clientFilter || dateFrom || dateTo || tab !== 'all') && (
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
              <Th>Status</Th>
              <Th>Created</Th>
              <Th>Client</Th>
              <Th className="text-right">Amount</Th>
              <Th>Description</Th>
              <Th>Customer</Th>
              {!isClientUser && <Th>Created by</Th>}
              <Th>Expires</Th>
              {canSeeFee && <Th className="text-right">FP Fee</Th>}
              <Th>Tx</Th>
              <Th style={{ width: 56 }}></Th>
            </Tr>
          </Thead>
          <tbody>
            {loading && <Tr><Td colSpan="11" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</Td></Tr>}
            {!loading && data.results.length === 0 && (
              <Tr><Td colSpan="11" style={{ textAlign: 'center', padding: '32px 16px' }}>
                <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
                  {tab === 'all' ? 'No payment links yet' : `No ${tab} links`}
                </div>
                {canEdit && (
                  <Button onClick={() => setCreateOpen(true)}><Plus size={14} /> Create first link</Button>
                )}
              </Td></Tr>
            )}
            {!loading && data.results.map((r) => (
              <PaymentLinkRow
                key={r.id}
                row={r}
                isClientUser={isClientUser}
                canSeeFee={canSeeFee}
                canEdit={canEdit}
                onOpenDetail={() => setOpenDetail(r)}
                onCopyUrl={() => copyUrl(r)}
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

      {createOpen && (
        <PLForm
          clients={clients} entities={entities} merchants={merchants}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); load(); }}
        />
      )}

      {openDetail && (
        <PaymentLinkDetail
          row={openDetail}
          canSeeFee={canSeeFee}
          onClose={() => setOpenDetail(null)}
          onCopyUrl={() => copyUrl(openDetail)}
          onShowQr={() => setQrModal(openDetail)}
        />
      )}

      {qrModal && <QrModal row={qrModal} onClose={() => setQrModal(null)} />}

      {cancelModal && (
        <CancelModal row={cancelModal} onClose={() => setCancelModal(null)} onConfirm={() => doCancel(cancelModal)} />
      )}
    </div>
  );
}

// ━━━ Stat card ─────────────────────────────────────────────
function StatCard({ label, value, tone }) {
  const colors = {
    success: 'var(--success)',
    warning: 'var(--warning)',
    accent: 'var(--accent)',
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

// ━━━ Row + kebab menu ──────────────────────────────────────
function PaymentLinkRow({ row, isClientUser, canSeeFee, canEdit, onOpenDetail, onCopyUrl, onShowQr, onOpenPage, onResendEmail, onCancel }) {
  const tone = STATUS_TONE[row.status] || 'neutral';
  const expires = row.status === 'paid' ? 'Paid' : (row.expires_at ? relativeTime(row.expires_at) : '—');
  return (
    <Tr style={{ cursor: 'pointer' }} onClick={onOpenDetail}>
      <Td><Badge tone={tone}>{row.status}</Badge></Td>
      <Td title={row.created_at}>{relativeTime(row.created_at)}</Td>
      <Td>{row.client?.name || '—'}</Td>
      <Td className="text-right font-mono">{money(row.amount)}</Td>
      <Td title={row.description} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.description || '—'}
      </Td>
      <Td>
        {row.customer_email || row.customer_name ? (
          <div style={{ fontSize: 12 }}>
            <div>{row.customer_name || '—'}</div>
            {row.customer_email && <div style={{ color: 'var(--text-tertiary)' }}>{row.customer_email}</div>}
          </div>
        ) : '—'}
      </Td>
      {!isClientUser && <Td>{row.created_by?.name || '—'}</Td>}
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
          onCopyUrl={onCopyUrl}
          onShowQr={onShowQr}
          onOpenPage={onOpenPage}
          onResendEmail={onResendEmail}
          onCancel={onCancel}
          onOpenDetail={onOpenDetail}
        />
      </Td>
    </Tr>
  );
}

function KebabMenu({ row, canEdit, onCopyUrl, onShowQr, onOpenPage, onResendEmail, onCancel, onOpenDetail }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    function place() {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuH = menuRef.current?.offsetHeight || 220;
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
            <MenuItem icon={Mail} onClick={() => { setOpen(false); onResendEmail(); }}>Email to customer</MenuItem>
          )}
          <MenuDivider />
          <MenuItem icon={Eye} onClick={() => { setOpen(false); onOpenDetail(); }}>View details</MenuItem>
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

// ━━━ Detail slide-over ────────────────────────────────────
function PaymentLinkDetail({ row, canSeeFee, onClose, onCopyUrl, onShowQr }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    api.get(`/api/payment-links/${row.id}`).then(setDetail).catch(() => setDetail({ link: row, timeline: [] }));
  }, [row.id]);

  const link = detail?.link || row;
  const timeline = detail?.timeline || [];
  const url = link.url || `https://portal.foundapay.com/pay/${link.token}`;

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        zIndex: 1100, display: 'flex', justifyContent: 'flex-end',
      }}>
      <div className="fp-card" style={{
        width: '100%', maxWidth: 720, height: '100vh', overflowY: 'auto',
        borderRadius: 0, padding: 24,
      }}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Payment Link
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{link.description || `Request #${link.id?.slice(0, 8)}`}</h2>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={STATUS_TONE[link.status] || 'neutral'}>{link.status}</Badge>
              <span style={{ fontSize: 18, fontWeight: 600 }}>{money(link.amount)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={22} />
          </button>
        </div>

        <Card className="p-4 mb-3">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>Public URL</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, wordBreak: 'break-all', background: 'var(--bg-tertiary)', padding: '8px 10px', borderRadius: 8 }}>
            {url}
          </div>
          <div className="flex gap-2 mt-3">
            <Button variant="secondary" onClick={onCopyUrl}><Copy size={14} /> Copy</Button>
            <Button variant="secondary" onClick={() => window.open(url, '_blank')}><ExternalLink size={14} /> Open</Button>
            <Button variant="secondary" onClick={onShowQr}><QrCode size={14} /> QR</Button>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <DetailField label="Token" value={link.token} mono />
          <DetailField label="Client" value={link.client?.name} />
          <DetailField label="Customer name" value={link.customer_name} />
          <DetailField label="Customer email" value={link.customer_email} />
          <DetailField label="Created" value={link.created_at ? new Date(link.created_at).toLocaleString() : null} />
          <DetailField label="Expires" value={link.expires_at ? new Date(link.expires_at).toLocaleString() : null} />
          <DetailField label="Attempts" value={link.attempts ?? 0} />
          <DetailField label="Invoice" value={link.invoice_number} />
        </div>

        {canSeeFee && link.status === 'paid' && (
          <Card className="p-4 mb-3" style={{ borderLeft: '3px solid var(--accent)' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>Settlement breakdown</div>
            <div className="space-y-1 text-sm">
              <Row label="Gross" value={money(link.amount)} />
              <Row label="FP Fee" value={money(link.fp_fee || 0)} />
              <Row label="Transaction" value={link.transaction?.id ? `#${link.transaction.id}` : '—'} />
            </div>
          </Card>
        )}

        <Card className="p-4">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>Timeline</div>
          {timeline.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No events recorded yet.</div>}
          <div className="space-y-3">
            {timeline.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 10 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--accent)', marginTop: 6, flexShrink: 0,
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{e.action}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {e.actor?.name || 'system'} · {new Date(e.at).toLocaleString()}
                  </div>
                  {e.metadata && Object.keys(e.metadata).length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'ui-monospace, monospace', marginTop: 4 }}>
                      {Object.entries(e.metadata)
                        .filter(([k]) => !['user_agent'].includes(k))
                        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                        .join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function DetailField({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 13, marginTop: 2, fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', wordBreak: 'break-all' }}>
        {value || '—'}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{value}</span>
    </div>
  );
}

// ━━━ QR modal ─────────────────────────────────────────────
function QrModal({ row, onClose }) {
  return (
    <Modal open onClose={onClose} title={`QR — ${row.description || row.id?.slice(0, 8)}`}
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

// ━━━ Cancel modal ─────────────────────────────────────────
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

// ━━━ Create / edit form (reused from previous version) ────
function PLForm({ pl, clients, entities, merchants, onClose, onSaved }) {
  const [form, setForm] = useState(pl || { currency: 'USD', payment_method: 'Debit/Credit Cards', status: 'requested' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = { ...form, amount: parseFloat(form.amount) || 0,
        client_id: form.client_id || null, entity_id: form.entity_id || null, merchant_id: form.merchant_id || null };
      if (pl) await api.patch(`/api/payment-links/${pl.id}`, body);
      else    await api.post('/api/payment-links', body);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={pl ? `Payment link #${pl.request_number || pl.id?.slice(0, 8)}` : 'New payment link'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Client</Label><Select value={form.client_id || ''} onChange={(e) => setForm(f => ({ ...f, client_id: e.target.value }))}><option value="">—</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount || ''} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
        <div><Label>Customer name</Label><Input value={form.customer_name || ''} onChange={(e) => setForm(f => ({ ...f, customer_name: e.target.value }))} /></div>
        <div><Label>Customer email</Label><Input type="email" value={form.customer_email || ''} onChange={(e) => setForm(f => ({ ...f, customer_email: e.target.value }))} /></div>
        <div><Label>Method</Label><Select value={form.payment_method} onChange={(e) => setForm(f => ({ ...f, payment_method: e.target.value }))}><option>Debit/Credit Cards</option><option>ACH</option><option>Wire Transfer</option><option>Zelle</option><option>PayPal</option></Select></div>
        <div><Label>Entity</Label><Select value={form.entity_id || ''} onChange={(e) => setForm(f => ({ ...f, entity_id: e.target.value }))}><option value="">—</option>{entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</Select></div>
        <div className="col-span-2"><Label>Description</Label><Input value={form.description || ''} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}
