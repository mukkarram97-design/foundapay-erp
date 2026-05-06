import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Filter, Download, Plus, Trash2, FileText } from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, PageHeader, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import TransactionDetail from '../components/ui/TransactionDetail';
import NewTransactionModal from '../components/NewTransactionModal';
import ConfirmDelete from '../components/ConfirmDelete';
import { useAuth } from '../store/auth';
import { downloadReceipt } from '../utils/downloadReceipt';

const STATUS_TONE = { Completed: 'green', Hold: 'amber', Processing: 'blue', 'Charge Back': 'red' };

const PAGE_SIZES = [50, 100, 'all'];

export default function Transactions() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [entities, setEntities] = useState([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ type: '', status: '', method: '', client_id: '', entity_id: '', from: '', to: '' });
  const [showFilters, setShowFilters] = useState(true);
  const [openTx, setOpenTx] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // { mode: 'single'|'bulk', target }
  const [selected, setSelected] = useState(new Set());
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [tx, cl, en] = await Promise.all([
        api.get('/api/transactions?limit=1000'),
        api.get('/api/clients'),
        api.get('/api/entities'),
      ]);
      setRows(tx.rows);
      setClients(cl.rows);
      setEntities(en.rows);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // / shortcut to focus search
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        e.preventDefault();
        document.getElementById('tx-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Client-side filter + search
  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    return rows.filter((t) => {
      if (filters.type && t.type !== filters.type) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.method && t.payment_method !== filters.method) return false;
      if (filters.client_id && t.client_id !== filters.client_id) return false;
      if (filters.entity_id && t.entity_id !== filters.entity_id) return false;
      if (filters.from && (t.date_received || '') < filters.from) return false;
      if (filters.to && (t.date_received || '') > filters.to) return false;
      if (s) {
        const hay = `${t.id} ${t.counterparty_name || ''} ${t.client_name || ''} ${t.entity_name || ''} ${t.merchant_account || ''} ${t.notes || ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, filters, search]);

  const totals = useMemo(() => {
    const r = { gross: 0, fees: 0, net: 0, paid: 0 };
    for (const t of filtered) {
      if (t.type === 'Received') {
        r.gross += parseFloat(t.gross_amount) || 0;
        r.fees += parseFloat(t.fee_amount) || 0;
        r.net += parseFloat(t.net_amount) || 0;
      } else if (t.type === 'Paid') {
        r.paid += parseFloat(t.gross_amount) || 0;
      }
    }
    return r;
  }, [filtered]);

  const paged = useMemo(() => {
    if (pageSize === 'all') return filtered;
    return filtered.slice((page - 1) * pageSize, page * pageSize);
  }, [filtered, pageSize, page]);
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));

  function clearFilters() {
    setFilters({ type: '', status: '', method: '', client_id: '', entity_id: '', from: '', to: '' });
    setSearch('');
    setPage(1);
  }
  const activeFilters = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => ({ k, v }));

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Master Ledger"
        subtitle={`${filtered.length} of ${rows.length} transactions`}
        actions={
          <>
            <Button variant="secondary" onClick={() => window.open('/api/transactions/export', '_blank')}>
              <Download size={14} /> Export CSV
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> New transaction
            </Button>
          </>
        }
      />

      {err && <Alert tone="error" className="mb-4">{err}</Alert>}

      {/* Search bar */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
        <Input
          id="tx-search"
          placeholder="Search by client, entity, merchant, ID, or notes... (press /)"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9 pr-9 h-10"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filter bar */}
      <Card className="p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <Filter size={14} style={{ color: 'var(--text-secondary)' }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Filters</span>
          <button onClick={() => setShowFilters(!showFilters)} className="text-xs ml-auto" style={{ color: 'var(--text-tertiary)' }}>
            {showFilters ? 'Hide' : 'Show'}
          </button>
        </div>
        {showFilters && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
                <option value="">All types</option><option>Received</option><option>Paid</option><option>Settlement</option><option>Chargeback</option>
              </Select>
              <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                <option value="">All statuses</option><option>Completed</option><option>Hold</option><option>Processing</option><option>Charge Back</option>
              </Select>
              <Select value={filters.method} onChange={(e) => setFilters((f) => ({ ...f, method: e.target.value }))}>
                <option value="">All methods</option><option>Debit/Credit Cards</option><option>ACH</option><option>Wire Transfer</option><option>Zelle</option><option>Cheque</option><option>PayPal</option>
              </Select>
              <Select value={filters.client_id} onChange={(e) => setFilters((f) => ({ ...f, client_id: e.target.value }))}>
                <option value="">All clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select value={filters.entity_id} onChange={(e) => setFilters((f) => ({ ...f, entity_id: e.target.value }))}>
                <option value="">All entities</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} placeholder="From" />
              <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} placeholder="To" />
              <Button variant="secondary" onClick={clearFilters}>Clear</Button>
              <div></div>
            </div>
            {activeFilters.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {activeFilters.map(({ k, v }) => (
                  <button
                    key={k}
                    onClick={() => setFilters((f) => ({ ...f, [k]: '' }))}
                    className="fp-badge fp-badge-accent"
                    style={{ cursor: 'pointer' }}
                  >
                    {k}: {String(v).slice(0, 16)} <X size={10} className="inline ml-1" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {/* Summary strip */}
      <Card className="p-3 mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm" style={{ background: 'var(--bg-tertiary)' }}>
        <Stat label="Gross received" value={money(totals.gross)} />
        <Stat label="Commission" value={money(totals.fees)} tone="success" />
        <Stat label="Net to clients" value={money(totals.net)} />
        <Stat label="Paid out" value={money(totals.paid)} tone="warning" />
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr>
              {isSuperAdmin && (
                <Th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={paged.length > 0 && paged.every((t) => selected.has(t.id))}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) paged.forEach((t) => next.add(t.id));
                      else paged.forEach((t) => next.delete(t.id));
                      setSelected(next);
                    }}
                  />
                </Th>
              )}
              <Th>#</Th><Th>Date</Th><Th>Type</Th><Th>Client</Th><Th>Method</Th>
              <Th>Entity</Th><Th>Processor</Th>
              <Th className="text-right">Gross</Th><Th className="text-right">Fee%</Th>
              <Th className="text-right">Commission</Th><Th className="text-right">Net</Th>
              <Th>Status</Th>
              <Th style={{ width: 80 }}></Th>
            </Tr>
          </Thead>
          <tbody>
            {loading && <Tr><Td colSpan={isSuperAdmin ? 14 : 13} style={{ color: 'var(--text-secondary)' }}>Loading…</Td></Tr>}
            {!loading && paged.length === 0 && <Tr><Td colSpan={isSuperAdmin ? 14 : 13} style={{ color: 'var(--text-secondary)' }}>No transactions match.</Td></Tr>}
            {!loading && paged.map((t) => (
              <Tr key={t.id} clickable onClick={() => setOpenTx(t)}>
                {isSuperAdmin && (
                  <Td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(t.id); else next.delete(t.id);
                        setSelected(next);
                      }}
                    />
                  </Td>
                )}
                <Td className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>#{t.id}</Td>
                <Td>{dateOnly(t.date_received)}</Td>
                <Td><Badge tone={t.type === 'Received' ? 'green' : t.type === 'Paid' ? 'amber' : 'zinc'}>{t.type}</Badge></Td>
                <Td>{t.client_name || t.counterparty_name || '—'}</Td>
                <Td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.payment_method || '—'}</Td>
                <Td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.entity_name || t.company_name || '—'}</Td>
                <Td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.processor_name || t.merchant_account || '—'}</Td>
                <Td className="text-right font-mono">{money(t.gross_amount)}</Td>
                <Td className="text-right text-xs" style={{ color: 'var(--text-secondary)' }}>{t.foundapay_fee_pct ? `${(t.foundapay_fee_pct * 100).toFixed(2)}%` : '—'}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--success)' }}>{money(t.fee_amount)}</Td>
                <Td className="text-right font-mono">{money(t.net_amount)}</Td>
                <Td><Badge tone={STATUS_TONE[t.status] || 'zinc'}>{t.status}</Badge></Td>
                <Td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button
                      title="Download receipt"
                      onClick={() => downloadReceipt(t.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)', display: 'inline-flex' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      <FileText size={14} />
                    </button>
                    {isSuperAdmin && (
                      <button
                        title="Delete"
                        onClick={() => setConfirmDel({ mode: 'single', target: t })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--danger)', display: 'inline-flex' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Floating bulk-select bar (super admin only) */}
      {isSuperAdmin && selected.size > 0 && (
        <div
          className="fp-slide-up"
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 50,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: '10px 16px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.30)',
            display: 'flex', alignItems: 'center', gap: 14,
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
            <strong>{selected.size}</strong> selected — total{' '}
            <span style={{ fontFamily: 'monospace' }}>
              {money(rows.filter((r) => selected.has(r.id)).reduce((a, r) => a + (parseFloat(r.gross_amount) || 0), 0))}
            </span>
          </span>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Deselect all</Button>
          <Button
            variant="danger"
            onClick={() => {
              const ids = [...selected];
              const total = rows.filter((r) => selected.has(r.id)).reduce((a, r) => a + (parseFloat(r.gross_amount) || 0), 0);
              setConfirmDel({ mode: 'bulk', target: { ids, count: ids.length, total } });
            }}
          >
            <Trash2 size={14} /> Delete {selected.size}
          </Button>
        </div>
      )}

      {/* Pagination */}
      {pageSize !== 'all' && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <div style={{ color: 'var(--text-secondary)' }}>
            Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}-{Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </div>
          <div className="flex items-center gap-2">
            <Select value={pageSize} onChange={(e) => { setPageSize(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10)); setPage(1); }} className="w-24">
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All' : s}</option>)}
            </Select>
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '0 8px', whiteSpace: 'nowrap' }}>
              Page {page} of {totalPages}
            </span>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Slide-over panels */}
      {openTx && (
        <TransactionDetail
          tx={openTx}
          clients={clients} entities={entities}
          onClose={() => setOpenTx(null)}
          onSaved={() => { setOpenTx(null); load(); }}
          onDeleted={() => { setOpenTx(null); load(); }}
        />
      )}
      {createOpen && (
        <NewTransactionModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); load(); }}
        />
      )}
      {confirmDel && (
        <ConfirmDelete
          mode={confirmDel.mode}
          target={confirmDel.target}
          onClose={() => setConfirmDel(null)}
          onDeleted={() => { setConfirmDel(null); setSelected(new Set()); load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  const colors = { success: 'var(--success)', warning: 'var(--warning)' };
  return (
    <div>
      <span className="text-[10px] font-semibold uppercase tracking-wider mr-2" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span className="font-mono text-sm" style={{ color: colors[tone] || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
