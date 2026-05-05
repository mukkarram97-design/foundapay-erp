import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Alert, Badge, Table, Thead, Th, Tr, Td, money } from '../components/ui';

const TABS = [
  { id: 'pnl', label: 'P&L' },
  { id: 'bs',  label: 'Balance Sheet' },
  { id: 'cs',  label: 'Client Statement' },
  { id: 'apr', label: 'April 2026' },
  { id: 'q1',  label: 'Q1 2026' },
];

export default function Reports() {
  const [tab, setTab] = useState('pnl');
  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader title="Reports" />
      <div className="flex gap-2 mb-4 border-b border-[var(--border)] pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === t.id ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >{t.label}</button>
        ))}
      </div>
      {tab === 'pnl' && <PnL />}
      {tab === 'bs' && <BalanceSheet />}
      {tab === 'cs' && <ClientStmt />}
      {tab === 'apr' && <AprilEmbed />}
      {tab === 'q1' && <Q1Embed />}
    </div>
  );
}

function PnL() {
  const [from, setFrom] = useState('2026-04-01');
  const [to, setTo] = useState('2026-04-30');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const r = await api.get(`/api/reports/pnl?from=${from}&to=${to}`);
      setData(r);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <>
      <Card className="p-3 mb-4 flex gap-2 items-end">
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button onClick={load}>Apply</Button>
      </Card>
      {err && <Alert tone="error" className="mb-4">{err}</Alert>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Commission revenue" value={money(data.totals.commission_revenue)} tone="green" />
            <Stat label="Gross profit" value={money(data.totals.gross_profit)} tone="green" />
            <Stat label="Total expenses" value={money(data.totals.total_expenses)} tone="amber" />
            <Stat label="Net profit" value={money(data.totals.net_profit)} tone={parseFloat(data.totals.net_profit) >= 0 ? 'green' : 'red'} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-medium text-[var(--text-primary)] mb-3">Revenue by entity</h3>
              <Table>
                <Thead><Tr><Th>Entity</Th><Th className="text-right">Revenue</Th></Tr></Thead>
                <tbody>{data.revenue_by_entity.slice(0, 15).map((e, i) => <Tr key={i}><Td>{e.entity}</Td><Td className="text-right font-mono">{money(e.revenue)}</Td></Tr>)}</tbody>
              </Table>
            </Card>
            <Card className="p-5">
              <h3 className="font-medium text-[var(--text-primary)] mb-3">Expenses by category</h3>
              <Table>
                <Thead><Tr><Th>Category</Th><Th className="text-right">Total</Th></Tr></Thead>
                <tbody>{data.expenses_by_category.length === 0 ? <Tr><Td colSpan="2" className="text-[var(--text-tertiary)]">No expenses</Td></Tr> : data.expenses_by_category.map((e, i) => <Tr key={i}><Td>{e.category || 'Uncategorized'}</Td><Td className="text-right font-mono">{money(e.total)}</Td></Tr>)}</tbody>
              </Table>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function BalanceSheet() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.get('/api/reports/balance-sheet').then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <Alert tone="error">{err}</Alert>;
  if (!data) return <Card className="p-6 text-[var(--text-tertiary)]">Loading…</Card>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="p-5">
        <h3 className="font-medium text-[var(--text-primary)] mb-3">Assets</h3>
        <Row label="Cash in banks" value={money(data.assets.cash_in_banks)} />
        <Row label="Receivable from clients" value={money(data.assets.receivable_from_clients)} />
        <Row label="Reserve funds held" value={money(data.assets.reserve_funds_held)} />
        <Row label="Total assets" value={money(data.assets.total_assets)} bold tone="green" />
      </Card>
      <Card className="p-5">
        <h3 className="font-medium text-[var(--text-primary)] mb-3">Liabilities</h3>
        <Row label="Payable to clients" value={money(data.liabilities.payable_to_clients)} />
        <Row label="Total liabilities" value={money(data.liabilities.total_liabilities)} bold tone="amber" />
      </Card>
      <Card className="p-5 md:col-span-2">
        <h3 className="font-medium text-[var(--text-primary)] mb-3">Bank accounts</h3>
        <Table>
          <Thead><Tr><Th>Entity</Th><Th>Bank</Th><Th className="text-right">Balance</Th></Tr></Thead>
          <tbody>{data.bank_accounts.map((b, i) => <Tr key={i}><Td>{b.entity}</Td><Td className="text-[var(--text-secondary)]">{b.bank_name}</Td><Td className="text-right font-mono">{money(b.current_balance)}</Td></Tr>)}</tbody>
        </Table>
      </Card>
    </div>
  );
}

function ClientStmt() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('2026-04-01');
  const [to, setTo] = useState('2026-04-30');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { api.get('/api/clients').then(r => setClients(r.rows)).catch(() => {}); }, []);

  async function load() {
    if (!clientId) return;
    try { setData(await api.get(`/api/reports/client-statement?client_id=${clientId}&from=${from}&to=${to}`)); }
    catch (e) { setErr(e.message); }
  }

  return (
    <>
      <Card className="p-3 mb-4 flex gap-2 items-end">
        <div className="flex-1"><Label>Client</Label><Select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">— Select —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button onClick={load} disabled={!clientId}>Run</Button>
      </Card>
      {err && <Alert tone="error" className="mb-4">{err}</Alert>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Gross received" value={money(data.totals.gross_received)} />
            <Stat label="Commission" value={money(data.totals.commission)} tone="green" />
            <Stat label="Paid out" value={money(data.totals.paid_out)} tone="amber" />
            <Stat label="Reserve held" value={money(data.totals.reserve_held)} tone="violet" />
          </div>
          <Card className="overflow-hidden">
            <Table>
              <Thead><Tr><Th>Date</Th><Th>Type</Th><Th>Method</Th><Th className="text-right">Gross</Th><Th className="text-right">Commission</Th><Th className="text-right">Net</Th><Th>Status</Th></Tr></Thead>
              <tbody>
                {data.transactions.map(t => (
                  <Tr key={t.id}>
                    <Td>{(t.date_received || '').toString().slice(0, 10)}</Td>
                    <Td><Badge tone={t.type === 'Received' ? 'green' : 'amber'}>{t.type}</Badge></Td>
                    <Td className="text-[var(--text-secondary)] text-xs">{t.payment_method || '—'}</Td>
                    <Td className="text-right font-mono">{money(t.gross_amount)}</Td>
                    <Td className="text-right font-mono text-[var(--text-secondary)]">{money(t.fee_amount)}</Td>
                    <Td className="text-right font-mono">{money(t.net_amount)}</Td>
                    <Td><Badge>{t.status}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

function AprilEmbed() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/api/reports/april-2026').then(setData); }, []);
  if (!data) return <Card className="p-6 text-[var(--text-tertiary)]">Loading…</Card>;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Gross (reconciled)" value={money(data.reconciled.gross)} />
      <Stat label="Revenue (reconciled)" value={money(data.reconciled.revenue)} tone="green" />
      <Stat label="Paid out (reconciled)" value={money(data.reconciled.paid_out)} tone="amber" />
      <Stat label="Tx count" value={data.reconciled.tx_count} />
      <Stat label="Gross (in DB)" value={money(data.db.gross)} />
      <Stat label="Revenue (in DB)" value={money(data.db.revenue)} tone="green" />
      <Stat label="Paid out (in DB)" value={money(data.db.paid_out)} tone="amber" />
      <Stat label="DB tx count" value={data.db.tx_count} />
    </div>
  );
}

function Q1Embed() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/api/reports/q1-2026').then(setData); }, []);
  if (!data) return <Card className="p-6 text-[var(--text-tertiary)]">Loading…</Card>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Jan gross" value={money(data.reconciled.jan.gross)} />
        <Stat label="Feb gross" value={money(data.reconciled.feb.gross)} />
        <Stat label="Mar gross" value={money(data.reconciled.mar.gross)} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Q1 gross" value={money(data.reconciled.total_gross)} tone="green" />
        <Stat label="Q1 revenue" value={money(data.reconciled.total_revenue)} tone="green" />
        <Stat label="Q1 net profit" value={money(data.reconciled.net_profit)} tone="green" />
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'zinc' }) {
  const tones = { zinc: 'text-[var(--text-primary)]', green: 'text-emerald-400', amber: 'text-amber-400', red: 'text-red-400', violet: 'text-[var(--accent)]' };
  return (
    <Card className="px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{label}</div>
      <div className={`text-xl font-semibold ${tones[tone]}`}>{value}</div>
    </Card>
  );
}

function Row({ label, value, bold, tone }) {
  const tones = { zinc: 'text-[var(--text-primary)]', green: 'text-emerald-400', amber: 'text-amber-400' };
  return (
    <div className={`flex items-center justify-between py-1.5 ${bold ? 'border-t border-[var(--border)] mt-2 pt-3' : ''}`}>
      <span className={`text-sm ${bold ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-secondary)]'}`}>{label}</span>
      <span className={`font-mono ${bold ? 'text-lg font-semibold' : ''} ${tones[tone] || 'text-[var(--text-primary)]'}`}>{value}</span>
    </div>
  );
}
