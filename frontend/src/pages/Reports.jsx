import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Cell,
} from 'recharts';
import { Download, FileText } from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, PageHeader, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import { downloadStatement, downloadReceipt } from '../utils/downloadReceipt';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Period helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ymd(d) { return new Date(d).toISOString().slice(0, 10); }
function startOfMonth(d) { const x = new Date(d); x.setDate(1); return x; }
function endOfMonth(d)   { const x = new Date(d); x.setMonth(x.getMonth() + 1, 0); return x; }
function quarterIndex(d) { return Math.floor(new Date(d).getMonth() / 3); }
function startOfQuarter(d) { const x = new Date(d); x.setMonth(quarterIndex(x) * 3, 1); return x; }
function endOfQuarter(d)   { const x = new Date(d); x.setMonth(quarterIndex(x) * 3 + 3, 0); return x; }
function startOfYear(d)    { const x = new Date(d); x.setMonth(0, 1); return x; }

function rangeFor(preset) {
  const today = new Date();
  switch (preset) {
    case 'mtd':           return { from: ymd(startOfMonth(today)),     to: ymd(today) };
    case 'qtd':           return { from: ymd(startOfQuarter(today)),   to: ymd(today) };
    case 'ytd':           return { from: ymd(startOfYear(today)),      to: ymd(today) };
    case 'last_month': {
      const lm = new Date(today); lm.setMonth(lm.getMonth() - 1);
      return { from: ymd(startOfMonth(lm)), to: ymd(endOfMonth(lm)) };
    }
    case 'last_quarter': {
      const lq = new Date(today); lq.setMonth(lq.getMonth() - 3);
      return { from: ymd(startOfQuarter(lq)), to: ymd(endOfQuarter(lq)) };
    }
    default:              return { from: ymd(startOfMonth(today)),     to: ymd(today) };
  }
}

const PRESETS = [
  { id: 'mtd',          label: 'MTD' },
  { id: 'qtd',          label: 'QTD' },
  { id: 'ytd',          label: 'YTD' },
  { id: 'last_month',   label: 'Last Month' },
  { id: 'last_quarter', label: 'Last Quarter' },
  { id: 'custom',       label: 'Custom Range' },
];

const TABS = [
  { id: 'pnl',     label: 'P&L Report' },
  { id: 'bs',      label: 'Balance Sheet' },
  { id: 'cs',      label: 'Client Statements' },
  { id: 'tx',      label: 'Transactions Report' },
  { id: 'entity',  label: 'Entity Report' },
  { id: 'rev',     label: 'Revenue Summary' },
  { id: 'recon',   label: 'Payout Recon' },
  { id: 'tax',     label: 'Tax Summary' },
  { id: 'export',  label: 'Custom Export' },
];

// Direct-download helper (auth-bearing fetch, then save blob).
async function downloadFromApi(url, filename) {
  const token = localStorage.getItem('foundapay_token');
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  const blob = await r.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main page
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function Reports() {
  const [preset, setPreset] = useState('mtd');
  const [{ from, to }, setRange] = useState(rangeFor('mtd'));
  const [tab, setTab] = useState('pnl');

  function selectPreset(id) {
    setPreset(id);
    if (id !== 'custom') setRange(rangeFor(id));
  }

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Reports"
        subtitle="Period-aware financials. Choose a preset or define a custom range."
      />

      {/* Period selector strip */}
      <Card className="p-4 mb-4">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => selectPreset(p.id)}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                border: `1px solid ${preset === p.id ? 'var(--accent)' : 'var(--border)'}`,
                background: preset === p.id ? 'var(--accent)' : 'transparent',
                color: preset === p.id ? '#FFFFFF' : 'var(--text-primary)',
                cursor: 'pointer', transition: 'all 150ms',
              }}
            >{p.label}</button>
          ))}

          <span style={{ flex: 1 }} />

          <span
            style={{
              fontSize: 12, fontWeight: 500,
              background: 'var(--accent-dim)', color: 'var(--accent)',
              border: '1px solid var(--accent)',
              borderRadius: 999, padding: '6px 12px',
            }}
          >
            {fmtRange(from, to)}
          </span>
        </div>

        {preset === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 12 }}>
            <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></div>
            <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></div>
            <Button variant="secondary" onClick={() => setRange((r) => ({ ...r }))}>Apply</Button>
          </div>
        )}
      </Card>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16, overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px', fontSize: 13, fontWeight: 500,
              color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'pnl'    && <PnLTab from={from} to={to} />}
      {tab === 'bs'     && <BalanceSheetTab />}
      {tab === 'cs'     && <ClientStatementsTab from={from} to={to} />}
      {tab === 'tx'     && <TransactionsReportTab from={from} to={to} />}
      {tab === 'entity' && <EntityReportTab from={from} to={to} />}
      {tab === 'rev'    && <RevenueSummaryTab from={from} to={to} />}
      {tab === 'recon'  && <PayoutReconTab from={from} to={to} />}
      {tab === 'tax'    && <TaxSummaryTab from={from} to={to} />}
      {tab === 'export' && <CustomExportTab from={from} to={to} />}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Revenue Summary
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function RevenueSummaryTab({ from, to }) {
  const [groupBy, setGroupBy] = useState('month');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    setErr(null);
    try {
      const r = await api.get(`/api/reports/revenue-summary?from=${from}&to=${to}&group_by=${groupBy}`);
      setData(r);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to, groupBy]);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!data) return <Card className="p-6" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>;
  const t = data.totals || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Label>Group by</Label>
        <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} style={{ maxWidth: 140 }}>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
        </Select>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => downloadFromApi(`/api/reports/revenue-summary?from=${from}&to=${to}&group_by=${groupBy}&format=pdf`, `revenue-summary-${from}-to-${to}.pdf`)}><Download size={12} /> PDF</Button>
        <Button variant="secondary" onClick={() => downloadFromApi(`/api/reports/revenue-summary?from=${from}&to=${to}&group_by=${groupBy}&format=csv`, `revenue-summary-${from}-to-${to}.csv`)}><Download size={12} /> CSV</Button>
        <Button variant="secondary" onClick={() => window.print()}><FileText size={12} /> Print</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniStat label="Gross volume" value={money(t.gross)} />
        <MiniStat label="FP revenue" value={money(t.revenue)} tone="success" />
        <MiniStat label="Net to clients" value={money(t.net)} tone="accent" />
        <MiniStat label="Transactions" value={t.tx_count || 0} />
      </div>

      <Card>
        <div style={{ padding: '14px 16px 6px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
          By {groupBy}
        </div>
        <Table>
          <Thead><Tr><Th>Period</Th><Th className="text-right">Gross</Th><Th className="text-right">Revenue</Th><Th className="text-right">Net</Th><Th className="text-right">#</Th></Tr></Thead>
          <tbody>{(data.byPeriod || []).map((r) => (
            <Tr key={r.period}>
              <Td>{r.period}</Td>
              <Td className="text-right font-mono">{money(r.gross)}</Td>
              <Td className="text-right font-mono">{money(r.revenue)}</Td>
              <Td className="text-right font-mono">{money(r.net)}</Td>
              <Td className="text-right">{r.tx_count}</Td>
            </Tr>
          ))}</tbody>
        </Table>
      </Card>

      {(data.byClient || []).length > 0 && (
        <Card>
          <div style={{ padding: '14px 16px 6px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
            By client
          </div>
          <Table>
            <Thead><Tr><Th>Client</Th><Th className="text-right">Gross</Th><Th className="text-right">Revenue</Th><Th className="text-right">#</Th></Tr></Thead>
            <tbody>{data.byClient.map((r) => (
              <Tr key={r.client_name}>
                <Td>{r.client_name || '—'}</Td>
                <Td className="text-right font-mono">{money(r.gross)}</Td>
                <Td className="text-right font-mono">{money(r.revenue)}</Td>
                <Td className="text-right">{r.tx_count}</Td>
              </Tr>
            ))}</tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Payout Reconciliation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function PayoutReconTab({ from, to }) {
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState([]);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/api/clients').then((r) => setClients(r.rows || [])).catch(() => {});
  }, []);

  async function load() {
    setErr(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (clientId) params.set('client_id', clientId);
      setData(await api.get(`/api/reports/payout-reconciliation?${params.toString()}`));
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to, clientId]);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!data) return <Card className="p-6" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>;
  const t = data.totals || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Label>Client</Label>
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => {
          const p = new URLSearchParams({ from, to, format: 'pdf' });
          if (clientId) p.set('client_id', clientId);
          downloadFromApi(`/api/reports/payout-reconciliation?${p.toString()}`, `payout-recon-${from}-to-${to}.pdf`);
        }}><Download size={12} /> PDF</Button>
        <Button variant="secondary" onClick={() => {
          const p = new URLSearchParams({ from, to, format: 'csv' });
          if (clientId) p.set('client_id', clientId);
          downloadFromApi(`/api/reports/payout-reconciliation?${p.toString()}`, `payout-recon-${from}-to-${to}.csv`);
        }}><Download size={12} /> CSV</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniStat label="Received" value={money(t.received)} />
        <MiniStat label="Paid out" value={money(t.paid_out)} tone="success" />
        <MiniStat label="Reserve held" value={money(t.reserve_held)} tone="accent" />
        <MiniStat label="Pending payout" value={money(t.pending)} tone="warning" />
      </div>

      <Card>
        <div style={{ padding: '14px 16px 6px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
          Payouts ({(data.payouts || []).length})
        </div>
        <Table>
          <Thead><Tr><Th>Date</Th><Th className="text-right">Amount</Th><Th>Method</Th><Th>Reference</Th><Th>Status</Th></Tr></Thead>
          <tbody>{(data.payouts || []).map((p) => (
            <Tr key={p.id}>
              <Td>{dateOnly(p.created_at)}</Td>
              <Td className="text-right font-mono">{money(p.amount)} {p.currency}</Td>
              <Td>{p.payout_method}</Td>
              <Td className="text-xs font-mono">{p.reference_number || '—'}</Td>
              <Td><Badge tone={p.status === 'sent' ? 'success' : 'warning'}>{p.status}</Badge></Td>
            </Tr>
          ))}</tbody>
        </Table>
      </Card>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tax Summary
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function TaxSummaryTab({ from, to }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setErr(null);
    api.get(`/api/reports/tax-summary?from=${from}&to=${to}`).then(setData).catch((e) => setErr(e.message));
  }, [from, to]);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!data) return <Card className="p-6" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>;
  const t = data.totals || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => downloadFromApi(`/api/reports/tax-summary?from=${from}&to=${to}&format=pdf`, `tax-summary-${from}-to-${to}.pdf`)}><Download size={12} /> PDF</Button>
        <Button variant="secondary" onClick={() => downloadFromApi(`/api/reports/tax-summary?from=${from}&to=${to}&format=csv`, `tax-summary-${from}-to-${to}.csv`)}><Download size={12} /> CSV</Button>
      </div>

      <Card className="p-5">
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <span>Gross income (commission + reserves released)</span>
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{money(t.gross_income)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <span>Less: deductible expenses</span>
          <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-secondary)' }}>-{money(t.deductible_expenses)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <span>Less: processor + chargeback fees borne</span>
          <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-secondary)' }}>-{money(t.fees_borne)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0 0', fontWeight: 700 }}>
          <span>Net taxable income</span>
          <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--accent)', fontSize: 18 }}>{money(t.net_taxable)}</span>
        </div>
      </Card>

      {(data.expenses_by_category || []).length > 0 && (
        <Card>
          <div style={{ padding: '14px 16px 6px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
            Expenses by category
          </div>
          <Table>
            <Thead><Tr><Th>Category</Th><Th className="text-right">Amount</Th></Tr></Thead>
            <tbody>{data.expenses_by_category.map((c) => (
              <Tr key={c.category}><Td>{c.category}</Td><Td className="text-right font-mono">{money(c.total)}</Td></Tr>
            ))}</tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Custom Transaction Export
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function CustomExportTab({ from, to }) {
  const [filters, setFilters] = useState({ status: '', type: '', payment_method: '', source: '', q: '' });
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><Label>Status</Label>
            <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">All</option>
              <option>Completed</option><option>Hold</option><option>Failed</option><option>Refunded</option><option>Voided</option><option>Charge Back</option>
            </Select>
          </div>
          <div><Label>Type</Label>
            <Select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
              <option value="">All</option>
              <option>Received</option><option>Paid</option><option>Expense</option><option>Advance Paid</option>
            </Select>
          </div>
          <div><Label>Method</Label>
            <Select value={filters.payment_method} onChange={(e) => setFilters((f) => ({ ...f, payment_method: e.target.value }))}>
              <option value="">All</option>
              <option>Debit/Credit Cards</option><option>ACH</option><option>Wire Transfer</option><option>Zelle</option><option>Cheque</option>
            </Select>
          </div>
          <div><Label>Source</Label>
            <Select value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}>
              <option value="">All</option>
              <option value="manual">Manual</option><option value="virtual_terminal">VT</option><option value="payment_link">Payment link</option>
            </Select>
          </div>
          <div className="col-span-2"><Label>Search</Label>
            <Input placeholder="Customer/email/auth code" value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Period: {from} → {to}. Up to 10 000 rows per export.</span>
          <span style={{ flex: 1 }} />
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const p = new URLSearchParams({ from, to, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
              await downloadFromApi(`/api/reports/transaction-export?${p.toString()}`, `transactions-${from}-to-${to}.csv`);
            } catch (e) { alert(e.message); }
            finally { setBusy(false); }
          }}>
            <Download size={12} /> {busy ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  const colors = { success: 'var(--success)', warning: 'var(--warning)', accent: 'var(--accent)' };
  return (
    <Card className="p-3">
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: colors[tone] || 'var(--text-primary)' }}>{value}</div>
    </Card>
  );
}

function fmtRange(from, to) {
  const f = new Date(from), t = new Date(to);
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${f.toLocaleDateString('en-US', opts)} – ${t.toLocaleDateString('en-US', opts)}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 1 — P&L
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function PnLTab({ from, to }) {
  const [data, setData] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get(`/api/reports/pnl?from=${from}&to=${to}`),
      api.get(`/api/expenses?from=${from}&to=${to}`),
    ]).then(([pnl, ex]) => {
      if (!alive) return;
      setData(pnl); setExpenses(ex.rows || []);
    }).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [from, to]);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!data) return <Card className="p-8" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>;

  const expensesByCategory = {};
  for (const e of expenses) {
    const cat = e.category || 'Other';
    expensesByCategory[cat] = (expensesByCategory[cat] || 0) + (parseFloat(e.amount) || 0);
  }
  const expCategories = Object.entries(expensesByCategory).sort((a, b) => b[1] - a[1]);
  const totalExpenses = expCategories.reduce((s, [, v]) => s + v, 0);

  const revenue = parseFloat(data.totals.commission_revenue) || 0;
  const grossProfit = parseFloat(data.totals.gross_profit) || 0;
  const netProfit = revenue - totalExpenses;

  const chartData = [
    { name: 'Revenue',    value: revenue,         color: '#10B981' },
    { name: 'Expenses',   value: totalExpenses,   color: '#EF4444' },
    { name: 'Net Profit', value: netProfit,       color: '#7C3AED' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total Revenue" value={money(revenue)} tone="success" />
        <KPI label="Total Expenses" value={money(totalExpenses)} tone="warning" />
        <KPI label="Gross Profit" value={money(grossProfit)} />
        <KPI label="Net Profit" value={money(netProfit)} tone={netProfit >= 0 ? 'success' : 'danger'} bold />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 12 }}>Revenue by Entity</h3>
          <Table>
            <Thead><Tr><Th>Entity</Th><Th className="text-right">Revenue</Th></Tr></Thead>
            <tbody>
              {data.revenue_by_entity.length === 0 && <Tr><Td colSpan="2" style={{ color: 'var(--text-tertiary)' }}>No data in range</Td></Tr>}
              {data.revenue_by_entity.slice(0, 15).map((e, i) => (
                <Tr key={i}>
                  <Td>{e.entity}</Td>
                  <Td className="text-right font-mono">{money(e.revenue)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card className="p-5">
          <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 12 }}>Expenses by Category</h3>
          <Table>
            <Thead><Tr><Th>Category</Th><Th className="text-right">Total</Th></Tr></Thead>
            <tbody>
              {expCategories.length === 0 && <Tr><Td colSpan="2" style={{ color: 'var(--text-tertiary)' }}>No expenses recorded in range</Td></Tr>}
              {expCategories.map(([c, v]) => (
                <Tr key={c}><Td>{c}</Td><Td className="text-right font-mono">{money(v)}</Td></Tr>
              ))}
              {totalExpenses > 0 && (
                <Tr><Td style={{ fontWeight: 600 }}>Total</Td>
                    <Td className="text-right font-mono" style={{ fontWeight: 600 }}>{money(totalExpenses)}</Td></Tr>
              )}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card className="p-5">
        <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 12 }}>Revenue vs Expenses</h3>
        <div style={{ height: 250 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" onClick={() => window.print()}>
          <Download size={14} /> Print / PDF
        </Button>
        <Button variant="secondary" onClick={() => window.open(`/api/transactions/export`, '_blank')}>
          <Download size={14} /> Export CSV
        </Button>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 2 — Balance Sheet
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function BalanceSheetTab() {
  const [data, setData] = useState(null);
  const [partners, setPartners] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/api/reports/balance-sheet'), api.get('/api/partners')])
      .then(([bs, p]) => { setData(bs); setPartners(p); })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!data) return <Card className="p-8" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>;

  const totalAssets = parseFloat(data.assets.total_assets) || 0;
  const totalLiabilities = parseFloat(data.liabilities.total_liabilities) || 0;
  const equity = totalAssets - totalLiabilities;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--success)' }}>ASSETS</h3>
        <BSRow label="Cash & Bank Balances" value={money(data.assets.cash_in_banks)} />
        <BSRow label="Reserve Receivable" value={money(data.assets.reserve_funds_held)} />
        <BSRow label="Receivable from Clients" value={money(data.assets.receivable_from_clients)} />
        <BSRow label="Total Assets" value={money(totalAssets)} bold tone="success" />
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--warning)' }}>LIABILITIES</h3>
        <BSRow label="Client Payable" value={money(data.liabilities.payable_to_clients)} />
        <BSRow label="Total Liabilities" value={money(totalLiabilities)} bold tone="warning" />
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--accent)' }}>EQUITY</h3>
        <BSRow label="Net Equity" value={money(equity)} bold tone="accent" />
        {partners?.owners?.length > 0 && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Owner Equity</div>
            {partners.owners.map((o) => (
              <div key={o.id} className="flex items-center justify-between py-1" style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--text-primary)' }}>{o.name}</span>
                <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                  {(parseFloat(o.share_pct) * 100).toFixed(0)}% · {money(equity * parseFloat(o.share_pct))}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {data.bank_accounts && data.bank_accounts.length > 0 && (
        <Card className="p-5 md:col-span-3">
          <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Bank Accounts (current balances)</h3>
          <Table>
            <Thead><Tr><Th>Entity</Th><Th>Bank</Th><Th className="text-right">Balance</Th></Tr></Thead>
            <tbody>
              {data.bank_accounts.map((b, i) => (
                <Tr key={i}>
                  <Td>{b.entity}</Td>
                  <Td style={{ color: 'var(--text-secondary)' }}>{b.bank_name}</Td>
                  <Td className="text-right font-mono">{money(b.current_balance)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 3 — Client Statements
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ClientStatementsTab({ from, to }) {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { api.get('/api/clients').then((r) => setClients(r.rows)).catch(() => {}); }, []);
  useEffect(() => { setData(null); }, [clientId, from, to]);

  async function load() {
    if (!clientId) return;
    try {
      const r = await api.get(`/api/clients/${clientId}/statement?from=${from}&to=${to}`);
      setData(r);
    } catch (e) { setErr(e.message); }
  }

  const client = clients.find((c) => c.id === clientId);
  const opening = client ? parseFloat(client.opening_balance || 0) : 0;
  const tx = data?.transactions || [];
  let running = opening;
  const enriched = tx.slice().reverse().map((t) => {
    const delta = t.type === 'Received' ? parseFloat(t.net_amount || 0) : -(parseFloat(t.gross_amount || 0));
    running += delta;
    return { ...t, _running: running };
  }).reverse();
  const closing = running;

  return (
    <div className="space-y-4">
      <Card className="p-3 flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <Label>Client</Label>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— Select client —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <Button onClick={load} disabled={!clientId}>Run statement</Button>
        {clientId && (
          <Button variant="secondary" onClick={() => downloadStatement(clientId, from, to)}>
            <FileText size={14} /> Download PDF
          </Button>
        )}
      </Card>

      {err && <Alert tone="error">{err}</Alert>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI label="Opening Balance" value={money(opening)} />
            <KPI label="Gross Received" value={money(data.totals.gross_received)} />
            <KPI label="Commission" value={money(data.totals.commission)} tone="success" />
            <KPI label="Reserve Held" value={money(data.totals.reserve_held)} tone="warning" />
            <KPI label="Closing Balance" value={money(closing)} bold tone={closing >= 0 ? 'success' : 'danger'} />
          </div>

          <Card className="overflow-hidden">
            <Table>
              <Thead>
                <Tr>
                  <Th>Date</Th><Th>#</Th><Th>Type</Th><Th>Method</Th>
                  <Th className="text-right">Gross</Th>
                  <Th className="text-right">Commission</Th>
                  <Th className="text-right">Net</Th>
                  <Th className="text-right">Running balance</Th>
                  <Th>Status</Th><Th></Th>
                </Tr>
              </Thead>
              <tbody>
                {enriched.length === 0 && <Tr><Td colSpan="10" style={{ color: 'var(--text-tertiary)' }}>No transactions in this period</Td></Tr>}
                {enriched.map((t) => (
                  <Tr key={t.id}>
                    <Td>{dateOnly(t.date_received)}</Td>
                    <Td className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>#{t.id}</Td>
                    <Td><Badge tone={t.type === 'Received' ? 'success' : 'warning'}>{t.type}</Badge></Td>
                    <Td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.payment_method || '—'}</Td>
                    <Td className="text-right font-mono">{money(t.gross_amount)}</Td>
                    <Td className="text-right font-mono" style={{ color: 'var(--success)' }}>{money(t.fee_amount)}</Td>
                    <Td className="text-right font-mono">{money(t.net_amount)}</Td>
                    <Td className="text-right font-mono" style={{ color: t._running < 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                      {money(t._running)}
                    </Td>
                    <Td><Badge>{t.status}</Badge></Td>
                    <Td><button onClick={() => downloadReceipt(t.id)} title="Receipt"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)' }}>
                      <FileText size={14} /></button></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 4 — Transactions Report
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function TransactionsReportTab({ from, to }) {
  const [groupBy, setGroupBy] = useState('client');
  const [tx, setTx] = useState([]);
  const [prevTx, setPrevTx] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const fmd = new Date(from), tmd = new Date(to);
    const days = Math.ceil((tmd - fmd) / 86400000) + 1;
    const prevTo = new Date(fmd); prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1));

    Promise.all([
      api.get(`/api/transactions?from=${from}&to=${to}&limit=5000`),
      api.get(`/api/transactions?from=${ymd(prevFrom)}&to=${ymd(prevTo)}&limit=5000`),
    ]).then(([a, b]) => { setTx(a.rows); setPrevTx(b.rows); })
      .catch((e) => setErr(e.message));
  }, [from, to]);

  if (err) return <Alert tone="error">{err}</Alert>;

  const groupings = useMemo(() => buildGroupings(tx, prevTx, groupBy), [tx, prevTx, groupBy]);

  const totals = tx.reduce((a, t) => {
    if (t.type === 'Received') {
      a.gross += parseFloat(t.gross_amount) || 0;
      a.fee   += parseFloat(t.fee_amount) || 0;
      a.net   += parseFloat(t.net_amount) || 0;
    } else if (t.type === 'Paid') a.paid += parseFloat(t.gross_amount) || 0;
    return a;
  }, { gross: 0, fee: 0, net: 0, paid: 0 });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Group by</span>
        {[
          { id: 'client', label: 'Client' },
          { id: 'entity', label: 'Entity' },
          { id: 'method', label: 'Method' },
          { id: 'status', label: 'Status' },
        ].map((g) => (
          <button
            key={g.id}
            onClick={() => setGroupBy(g.id)}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              border: `1px solid ${groupBy === g.id ? 'var(--accent)' : 'var(--border)'}`,
              background: groupBy === g.id ? 'var(--accent-dim)' : 'transparent',
              color: groupBy === g.id ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >{g.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => window.open(`/api/transactions/export`, '_blank')}>
          <Download size={14} /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Gross received" value={money(totals.gross)} />
        <KPI label="Commission" value={money(totals.fee)} tone="success" />
        <KPI label="Net to clients" value={money(totals.net)} />
        <KPI label="Paid out" value={money(totals.paid)} tone="warning" />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr>
              <Th>{groupByLabel(groupBy)}</Th>
              <Th className="text-right">Tx Count</Th>
              <Th className="text-right">Gross</Th>
              <Th className="text-right">Commission</Th>
              <Th className="text-right">vs Last period</Th>
            </Tr>
          </Thead>
          <tbody>
            {groupings.length === 0 && <Tr><Td colSpan="5" style={{ color: 'var(--text-tertiary)' }}>No transactions in range</Td></Tr>}
            {groupings.map((g) => (
              <Tr key={g.key}>
                <Td>{g.key}</Td>
                <Td className="text-right">{g.count}</Td>
                <Td className="text-right font-mono">{money(g.gross)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--success)' }}>{money(g.fee)}</Td>
                <Td className="text-right font-mono" style={{ color: g.delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {g.delta >= 0 ? '▲' : '▼'} {Math.abs(g.deltaPct).toFixed(1)}%
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function groupByLabel(g) {
  return ({ client: 'Client', entity: 'Entity', method: 'Method', status: 'Status' })[g];
}
function buildGroupings(curr, prev, by) {
  const keyOf = (t) => ({
    client: t.client_name || t.counterparty_name || '—',
    entity: t.entity_name || t.company_name || '—',
    method: t.payment_method || '—',
    status: t.status || '—',
  })[by];
  const fold = (rows) => {
    const m = new Map();
    for (const t of rows) {
      if (t.type !== 'Received') continue;
      const k = keyOf(t);
      const e = m.get(k) || { key: k, count: 0, gross: 0, fee: 0 };
      e.count += 1;
      e.gross += parseFloat(t.gross_amount) || 0;
      e.fee   += parseFloat(t.fee_amount) || 0;
      m.set(k, e);
    }
    return m;
  };
  const c = fold(curr), p = fold(prev);
  return [...c.values()].map((g) => {
    const prevG = p.get(g.key);
    const prevGross = prevG ? prevG.gross : 0;
    const delta = g.gross - prevGross;
    const deltaPct = prevGross ? (delta / prevGross) * 100 : (g.gross > 0 ? 100 : 0);
    return { ...g, delta, deltaPct };
  }).sort((a, b) => b.gross - a.gross);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 5 — Entity Report
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function EntityReportTab({ from, to }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/api/reports/entity-breakdown?from=${from}&to=${to}`)
      .then(setData).catch((e) => setErr(e.message));
  }, [from, to]);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!data) return <Card className="p-8" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>;

  const chartData = data.rows.slice(0, 10).map((e) => ({
    name: e.entity.replace(' Inc', '').slice(0, 18),
    gross: parseFloat(e.gross) || 0,
    revenue: parseFloat(e.revenue) || 0,
  }));

  const totalGross = data.rows.reduce((s, e) => s + (parseFloat(e.gross) || 0), 0);
  const totalRev = data.rows.reduce((s, e) => s + (parseFloat(e.revenue) || 0), 0);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Entity comparison</h3>
        <div style={{ height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
              <Bar dataKey="gross"   name="Gross volume" fill="#7C3AED" radius={[4, 4, 0, 0]} />
              <Bar dataKey="revenue" name="FP revenue"   fill="#10B981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr>
              <Th>Entity</Th><Th>Partner</Th>
              <Th className="text-right">Tx Count</Th>
              <Th className="text-right">Gross Volume</Th>
              <Th className="text-right">FP Revenue</Th>
              <Th className="text-right">Partner Share (10%)</Th>
            </Tr>
          </Thead>
          <tbody>
            {data.rows.map((e, i) => {
              const partnerShare = (parseFloat(e.revenue) || 0) * 0.10;
              return (
                <Tr key={i}>
                  <Td className="font-medium">{e.entity}</Td>
                  <Td style={{ color: 'var(--text-secondary)' }}>{e.partner_name || '—'}</Td>
                  <Td className="text-right">{e.tx_count}</Td>
                  <Td className="text-right font-mono">{money(e.gross)}</Td>
                  <Td className="text-right font-mono" style={{ color: 'var(--success)' }}>{money(e.revenue)}</Td>
                  <Td className="text-right font-mono" style={{ color: 'var(--accent)' }}>{money(partnerShare)}</Td>
                </Tr>
              );
            })}
            {data.rows.length > 0 && (
              <Tr>
                <Td colSpan="3" style={{ fontWeight: 600 }}>Totals</Td>
                <Td className="text-right font-mono" style={{ fontWeight: 600 }}>{money(totalGross)}</Td>
                <Td className="text-right font-mono" style={{ fontWeight: 600, color: 'var(--success)' }}>{money(totalRev)}</Td>
                <Td className="text-right font-mono" style={{ fontWeight: 600, color: 'var(--accent)' }}>{money(totalRev * 0.10)}</Td>
              </Tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

// ━━━ Shared bits ─────────────────────────────────────────
function KPI({ label, value, tone = 'default', bold }) {
  const c = {
    default: 'var(--text-primary)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger:  'var(--danger)',
    accent:  'var(--accent)',
  }[tone];
  return (
    <Card className="p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: bold ? 26 : 20, fontWeight: bold ? 700 : 600, marginTop: 4, color: c }}>{value}</div>
    </Card>
  );
}

function BSRow({ label, value, bold, tone }) {
  const c = {
    success: 'var(--success)',
    warning: 'var(--warning)',
    accent:  'var(--accent)',
  }[tone] || 'var(--text-primary)';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '6px 0',
      borderTop: bold ? '1px solid var(--border)' : 'none',
      marginTop: bold ? 8 : 0,
      paddingTop: bold ? 12 : 6,
    }}>
      <span style={{ fontSize: 13, color: bold ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: bold ? 600 : 400 }}>
        {label}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: bold ? 16 : 13, fontWeight: bold ? 600 : 400, color: c }}>
        {value}
      </span>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="fp-card p-3" style={{ fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{money(p.value)}</span>
        </div>
      ))}
    </div>
  );
}
