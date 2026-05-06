import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreVertical, Send, Eye, Edit2, XCircle, Plus, Search, X, Download,
  Trash2, CheckCircle2, FileText, Copy,
} from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Textarea, Label, PageHeader, Modal, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';

const TABS = [
  { id: 'all',       label: 'All' },
  { id: 'draft',     label: 'Draft' },
  { id: 'sent',      label: 'Sent' },
  { id: 'viewed',    label: 'Viewed' },
  { id: 'paid',      label: 'Paid' },
  { id: 'overdue',   label: 'Overdue' },
  { id: 'cancelled', label: 'Cancelled' },
];

const STATUS_TONE = {
  draft: 'neutral', sent: 'info', viewed: 'info',
  paid: 'success', overdue: 'warning', cancelled: 'danger',
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

export default function Invoices() {
  const { user: me } = useAuth();
  const canEdit = ['super_admin', 'owner', 'admin', 'finance_manager'].includes(me?.role);

  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ results: [], total: 0, summary: {} });
  const [clients, setClients] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [openDetail, setOpenDetail] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const params = new URLSearchParams();
      params.set('tab', tab); params.set('page', String(page)); params.set('limit', '20');
      if (q) params.set('q', q);
      if (clientFilter) params.set('client_id', clientFilter);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const [inv, c, e] = await Promise.all([
        api.get(`/api/invoices?${params.toString()}`),
        clients.length ? Promise.resolve({ rows: clients }) : api.get('/api/clients'),
        entities.length ? Promise.resolve({ rows: entities }) : api.get('/api/entities'),
      ]);
      setData(inv);
      if (!clients.length) setClients(c.rows);
      if (!entities.length) setEntities(e.rows);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, page, q, clientFilter, from, to]);

  const summary = data.summary || {};
  const totalPages = Math.max(1, Math.ceil(data.total / 20));

  async function send(row) {
    try {
      const r = await api.post(`/api/invoices/${row.id}/send`, {});
      toast.success(`Invoice emailed to ${r.sent_to}${r.mode === 'console' ? ' (console mode)' : ''}`);
      load();
    } catch (e) { toast.error(e.message); }
  }
  async function markPaid(row) {
    try {
      await api.post(`/api/invoices/${row.id}/mark-paid`, {});
      toast.success('Invoice marked paid');
      load();
    } catch (e) { toast.error(e.message); }
  }
  async function doDelete() {
    try {
      await api.delete(`/api/invoices/${confirmDelete.id}`);
      toast.success('Invoice deleted');
      setConfirmDelete(null);
      load();
    } catch (e) { toast.error(e.message); }
  }
  function downloadPdf(row) {
    const token = localStorage.getItem('foundapay_token');
    fetch(`/api/invoices/${row.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${row.invoice_number}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })
      .catch(() => toast.error('Could not download PDF'));
  }

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Invoices"
        subtitle={`${summary.total_count ?? data.total} invoices · ${summary.sent_count ?? 0} sent · ${summary.paid_count ?? 0} paid`}
        actions={canEdit && <Button onClick={() => setCreateOpen(true)}><Plus size={14} /> New invoice</Button>}
      />

      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label="Total" value={summary.total_count ?? 0} />
        <StatCard label="Outstanding" value={money(summary.total_outstanding || 0)} tone="warning" />
        <StatCard label="Paid" value={money(summary.total_paid || 0)} tone="success" />
        <StatCard label="Overdue" value={summary.overdue_count ?? 0} tone="danger" />
      </div>

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
              {summary[`${t.id}_count`] != null && t.id !== 'all' && (
                <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>· {summary[`${t.id}_count`]}</span>
              )}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-3 mb-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <div className="md:col-span-2 relative">
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <Input
              placeholder="Search invoice #, customer name or email…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              style={{ paddingLeft: 36 }}
            />
          </div>
          <Select value={clientFilter} onChange={(e) => { setClientFilter(e.target.value); setPage(1); }}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
      </Card>

      <Card style={{ overflow: 'visible' }}>
        <Table>
          <Thead>
            <Tr>
              <Th>Status</Th>
              <Th>Invoice #</Th>
              <Th>Issue date</Th>
              <Th>Due</Th>
              <Th>Customer</Th>
              <Th>Client</Th>
              <Th className="text-right">Total</Th>
              <Th>Created</Th>
              <Th style={{ width: 56 }}></Th>
            </Tr>
          </Thead>
          <tbody>
            {loading && <Tr><Td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</Td></Tr>}
            {!loading && data.results.length === 0 && (
              <Tr><Td colSpan="9" style={{ textAlign: 'center', padding: '32px 16px' }}>
                <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
                  {tab === 'all' ? 'No invoices yet' : `No ${tab} invoices`}
                </div>
                {canEdit && <Button onClick={() => setCreateOpen(true)}><Plus size={14} /> Create first invoice</Button>}
              </Td></Tr>
            )}
            {!loading && data.results.map((r) => (
              <InvoiceRow
                key={r.id}
                row={r}
                canEdit={canEdit}
                onOpenDetail={() => setOpenDetail(r)}
                onSend={() => send(r)}
                onMarkPaid={() => markPaid(r)}
                onEdit={() => setEditing(r)}
                onDelete={() => setConfirmDelete(r)}
                onPdf={() => downloadPdf(r)}
              />
            ))}
          </tbody>
        </Table>
      </Card>

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

      {(createOpen || editing) && (
        <InvoiceForm
          inv={editing}
          clients={clients}
          entities={entities}
          onClose={() => { setCreateOpen(false); setEditing(null); }}
          onSaved={() => { setCreateOpen(false); setEditing(null); load(); }}
        />
      )}

      {openDetail && (
        <InvoiceDetail
          row={openDetail}
          onClose={() => setOpenDetail(null)}
          onPdf={() => downloadPdf(openDetail)}
          onSend={() => send(openDetail)}
          onMarkPaid={() => markPaid(openDetail)}
        />
      )}

      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(null)} title="Delete invoice?"
          footer={<>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={doDelete}>Delete</Button>
          </>}>
          <p>Are you sure you want to delete <strong>{confirmDelete.invoice_number}</strong>? This is reversible only by a database admin.</p>
        </Modal>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const colors = { success: 'var(--success)', warning: 'var(--warning)', accent: 'var(--accent)', danger: 'var(--danger)' };
  return (
    <Card className="p-4">
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: colors[tone] || 'var(--text-primary)' }}>{value}</div>
    </Card>
  );
}

function InvoiceRow({ row, canEdit, onOpenDetail, onSend, onMarkPaid, onEdit, onDelete, onPdf }) {
  return (
    <Tr style={{ cursor: 'pointer' }} onClick={onOpenDetail}>
      <Td><Badge tone={STATUS_TONE[row.status] || 'neutral'}>{row.status}</Badge></Td>
      <Td className="font-mono">{row.invoice_number}</Td>
      <Td>{dateOnly(row.issue_date)}</Td>
      <Td>{row.due_date ? dateOnly(row.due_date) : '—'}</Td>
      <Td>
        {row.customer_name || row.customer_email ? (
          <div style={{ fontSize: 12 }}>
            <div>{row.customer_name || '—'}</div>
            {row.customer_email && <div style={{ color: 'var(--text-tertiary)' }}>{row.customer_email}</div>}
          </div>
        ) : '—'}
      </Td>
      <Td>{row.client_name || '—'}</Td>
      <Td className="text-right font-mono">{money(row.total_amount)}</Td>
      <Td className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{relativeTime(row.created_at)}</Td>
      <Td onClick={(e) => e.stopPropagation()}>
        <KebabMenu
          row={row} canEdit={canEdit}
          onSend={onSend} onMarkPaid={onMarkPaid} onEdit={onEdit}
          onDelete={onDelete} onPdf={onPdf} onOpenDetail={onOpenDetail}
        />
      </Td>
    </Tr>
  );
}

function KebabMenu({ row, canEdit, onSend, onMarkPaid, onEdit, onDelete, onPdf, onOpenDetail }) {
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
      const gap = 6;
      let top = rect.bottom + gap;
      if (top + menuH > window.innerHeight - 12) top = Math.max(12, rect.top - menuH - gap);
      let left = rect.right - 220;
      if (left < 12) left = 12;
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

  const isEditable = ['draft', 'sent', 'viewed'].includes(row.status);
  const canSend = canEdit && row.customer_email && row.status !== 'cancelled';
  const canMarkPaid = canEdit && row.status !== 'paid' && row.status !== 'cancelled';

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
          position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999,
          width: 220, padding: 4, zIndex: 1000,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          visibility: pos ? 'visible' : 'hidden',
        }}>
          <MenuItem icon={Eye} onClick={() => { setOpen(false); onOpenDetail(); }}>View details</MenuItem>
          <MenuItem icon={Download} onClick={() => { setOpen(false); onPdf(); }}>Download PDF</MenuItem>
          {canSend && <MenuItem icon={Send} onClick={() => { setOpen(false); onSend(); }}>Email to customer</MenuItem>}
          {canEdit && isEditable && (
            <MenuItem icon={Edit2} onClick={() => { setOpen(false); onEdit(); }}>Edit</MenuItem>
          )}
          {canMarkPaid && (
            <>
              <MenuDivider />
              <MenuItem icon={CheckCircle2} tone="success" onClick={() => { setOpen(false); onMarkPaid(); }}>Mark paid</MenuItem>
            </>
          )}
          {canEdit && row.status !== 'paid' && (
            <>
              <MenuDivider />
              <MenuItem icon={Trash2} tone="danger" onClick={() => { setOpen(false); onDelete(); }}>Delete</MenuItem>
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

// ━━━ Detail slide-over ─────────────────────────────────────
function InvoiceDetail({ row, onClose, onPdf, onSend, onMarkPaid }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    api.get(`/api/invoices/${row.id}`).then(setDetail).catch(() => setDetail({ invoice: row, timeline: [] }));
  }, [row.id]);
  const inv = detail?.invoice || row;
  const tl = detail?.timeline || [];

  let lineItems = inv.line_items || [];
  if (typeof lineItems === 'string') {
    try { lineItems = JSON.parse(lineItems); } catch { lineItems = []; }
  }

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
              Invoice
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{inv.invoice_number}</h2>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={STATUS_TONE[inv.status] || 'neutral'}>{inv.status}</Badge>
              <span style={{ fontSize: 18, fontWeight: 600 }}>{money(inv.total_amount)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={22} />
          </button>
        </div>

        <Card className="p-4 mb-3">
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={onPdf}><Download size={14} /> PDF</Button>
            {inv.customer_email && inv.status !== 'cancelled' && (
              <Button variant="secondary" onClick={onSend}><Send size={14} /> Email</Button>
            )}
            {inv.status !== 'paid' && inv.status !== 'cancelled' && (
              <Button variant="success" onClick={onMarkPaid}><CheckCircle2 size={14} /> Mark paid</Button>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <DetailField label="Customer" value={inv.customer_name} />
          <DetailField label="Customer email" value={inv.customer_email} />
          <DetailField label="Issue date" value={dateOnly(inv.issue_date)} />
          <DetailField label="Due date" value={inv.due_date ? dateOnly(inv.due_date) : '—'} />
          <DetailField label="Client" value={inv.client_name} />
          <DetailField label="Entity" value={inv.entity_name} />
          {inv.paid_at && <DetailField label="Paid at" value={new Date(inv.paid_at).toLocaleString()} />}
          {inv.transaction_id && <DetailField label="Transaction" value={`#${inv.transaction_id}`} />}
        </div>

        <Card className="p-4 mb-3">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>Line items</div>
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-tertiary)', fontSize: 11, textAlign: 'left' }}>
                <th style={{ padding: '6px 4px' }}>Description</th>
                <th style={{ padding: '6px 4px', textAlign: 'right' }}>Qty</th>
                <th style={{ padding: '6px 4px', textAlign: 'right' }}>Unit</th>
                <th style={{ padding: '6px 4px', textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 4px' }}>{li.description}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{li.quantity}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{money(li.unit_price)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{money(li.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <Row label="Subtotal" value={money(inv.subtotal)} />
            {parseFloat(inv.discount_amount) > 0 && <Row label="Discount" value={`-${money(inv.discount_amount)}`} />}
            {parseFloat(inv.tax_rate) > 0 && (
              <Row label={`Tax (${(parseFloat(inv.tax_rate) * 100).toFixed(2)}%)`} value={money(inv.tax_amount)} />
            )}
            <Row label="Total" value={money(inv.total_amount)} bold />
          </div>
        </Card>

        {inv.notes && (
          <Card className="p-4 mb-3">
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>Notes</div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{inv.notes}</div>
          </Card>
        )}

        <Card className="p-4">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>Timeline</div>
          {tl.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No events yet.</div>}
          <div className="space-y-3">
            {tl.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{e.action}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {e.actor_name || 'system'} · {new Date(e.created_at).toLocaleString()}
                  </div>
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
function Row({ label, value, bold }) {
  return (
    <div className="flex justify-between" style={{ padding: '4px 0', fontWeight: bold ? 700 : 400, fontSize: bold ? 15 : 13 }}>
      <span style={{ color: bold ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{value}</span>
    </div>
  );
}

// ━━━ Create / edit form ──────────────────────────────────
function InvoiceForm({ inv, clients, entities, onClose, onSaved }) {
  const isEdit = !!inv;
  // tax_pct holds the *display* percentage (e.g. 8.25). Backend stores tax_rate as decimal (0.0825).
  const [form, setForm] = useState(() => inv ? {
    ...inv,
    line_items: typeof inv.line_items === 'string' ? JSON.parse(inv.line_items) : (inv.line_items || []),
    tax_pct: (parseFloat(inv.tax_rate) || 0) * 100,
    discount_amount: parseFloat(inv.discount_amount) || 0,
  } : {
    customer_name: '', customer_email: '', customer_phone: '', customer_address: '',
    client_id: '', entity_id: '',
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: '',
    line_items: [{ description: '', quantity: 1, unit_price: 0 }],
    tax_pct: 0,
    discount_amount: 0,
    notes: '', footer_text: '',
    currency: 'USD',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function setLine(i, k, v) {
    setForm((f) => ({ ...f, line_items: f.line_items.map((li, idx) => idx === i ? { ...li, [k]: v } : li) }));
  }
  function addLine() {
    setForm((f) => ({ ...f, line_items: [...f.line_items, { description: '', quantity: 1, unit_price: 0 }] }));
  }
  function removeLine(i) {
    setForm((f) => ({ ...f, line_items: f.line_items.filter((_, idx) => idx !== i) }));
  }

  // Live totals
  const subtotal = (form.line_items || []).reduce((s, li) => s + (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0), 0);
  const discount = parseFloat(form.discount_amount) || 0;
  const taxBase = Math.max(0, subtotal - discount);
  const taxRateDecimal = (parseFloat(form.tax_pct) || 0) / 100;
  const taxAmount = taxBase * taxRateDecimal;
  const total = taxBase + taxAmount;

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = {
        client_id: form.client_id || null,
        entity_id: form.entity_id || null,
        customer_name: form.customer_name || null,
        customer_email: form.customer_email || null,
        customer_phone: form.customer_phone || null,
        customer_address: form.customer_address || null,
        issue_date: form.issue_date || null,
        due_date: form.due_date || null,
        line_items: (form.line_items || []).filter((li) => li.description || li.unit_price),
        tax_rate: (parseFloat(form.tax_pct) || 0) / 100, // backend stores decimal
        discount_amount: parseFloat(form.discount_amount) || 0,
        currency: form.currency || 'USD',
        notes: form.notes || null,
        footer_text: form.footer_text || null,
      };
      if (isEdit) await api.put(`/api/invoices/${inv.id}`, body);
      else        await api.post('/api/invoices', body);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${inv.invoice_number}` : 'New invoice'} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : (isEdit ? 'Update' : 'Create')}</Button>
      </>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><Label>Client</Label>
          <Select value={form.client_id || ''} onChange={(e) => setField('client_id', e.target.value)}>
            <option value="">—</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div><Label>Entity</Label>
          <Select value={form.entity_id || ''} onChange={(e) => setField('entity_id', e.target.value)}>
            <option value="">—</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
          </Select>
        </div>
        <div><Label>Customer name</Label>
          <Input value={form.customer_name || ''} onChange={(e) => setField('customer_name', e.target.value)} />
        </div>
        <div><Label>Customer email</Label>
          <Input type="email" value={form.customer_email || ''} onChange={(e) => setField('customer_email', e.target.value)} />
        </div>
        <div><Label>Customer phone</Label>
          <Input value={form.customer_phone || ''} onChange={(e) => setField('customer_phone', e.target.value)} />
        </div>
        <div><Label>Issue date</Label>
          <Input type="date" value={form.issue_date || ''} onChange={(e) => setField('issue_date', e.target.value)} />
        </div>
        <div><Label>Due date</Label>
          <Input type="date" value={form.due_date || ''} onChange={(e) => setField('due_date', e.target.value)} />
        </div>
        <div className="col-span-2"><Label>Customer address</Label>
          <Textarea rows="2" value={form.customer_address || ''} onChange={(e) => setField('customer_address', e.target.value)} />
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <Label>Line items</Label>
        <Button variant="ghost" size="sm" onClick={addLine}><Plus size={12} /> Add line</Button>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: 13 }}>
          <thead style={{ background: 'var(--bg-tertiary)' }}>
            <tr style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left' }}>Description</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', width: 80 }}>Qty</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', width: 110 }}>Unit price</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', width: 110 }}>Line total</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {form.line_items.map((li, i) => {
              const lt = (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0);
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 6 }}>
                    <Input value={li.description || ''} onChange={(e) => setLine(i, 'description', e.target.value)} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <Input type="number" step="0.01" value={li.quantity ?? ''} onChange={(e) => setLine(i, 'quantity', e.target.value)} style={{ textAlign: 'right' }} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <Input type="number" step="0.01" value={li.unit_price ?? ''} onChange={(e) => setLine(i, 'unit_price', e.target.value)} style={{ textAlign: 'right' }} />
                  </td>
                  <td style={{ padding: 6, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{money(lt)}</td>
                  <td style={{ padding: 6, textAlign: 'center' }}>
                    <button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div><Label>Tax % <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'none', letterSpacing: 0 }}>(e.g. 8.25 for 8.25%)</span></Label>
          <Input type="number" step="0.01" placeholder="8.25" value={form.tax_pct ?? 0} onChange={(e) => setField('tax_pct', e.target.value)} />
        </div>
        <div><Label>Discount</Label>
          <Input type="number" step="0.01" value={form.discount_amount ?? 0} onChange={(e) => setField('discount_amount', e.target.value)} />
        </div>
      </div>

      <Card className="p-3 mt-4" style={{ background: 'var(--bg-tertiary)' }}>
        <Row label="Subtotal" value={money(subtotal)} />
        {discount > 0 && <Row label="Discount" value={`-${money(discount)}`} />}
        {parseFloat(form.tax_pct) > 0 && (
          <Row label={`Tax (${(parseFloat(form.tax_pct) || 0).toFixed(2)}%)`} value={money(taxAmount)} />
        )}
        <Row label="Total" value={money(total)} bold />
      </Card>

      <div className="grid grid-cols-1 gap-3 mt-4">
        <div><Label>Notes (visible on invoice)</Label>
          <Textarea rows="3" value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)} />
        </div>
        <div><Label>Footer text</Label>
          <Input value={form.footer_text || ''} onChange={(e) => setField('footer_text', e.target.value)} placeholder="Thank you for your business." />
        </div>
      </div>
    </Modal>
  );
}
