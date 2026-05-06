import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  TrendingUp, ArrowUpRight, Plus, Download, AlertTriangle,
  Wallet, ArrowDownToLine, Lock, CreditCard,
} from 'lucide-react';
import { api } from '../utils/api';
import { Card, Button, Badge, Alert, Table, Thead, Th, Tr, Td, money, dateOnly } from '../components/ui';
import TransactionDetail from '../components/ui/TransactionDetail';
import NewTransactionModal from '../components/NewTransactionModal';
import { useAuth } from '../store/auth';

const PERIODS = [
  { id: 'today',      label: 'Today' },
  { id: 'last_7d',    label: '7d' },
  { id: 'last_30d',   label: '30d' },
  { id: 'mtd',        label: 'MTD' },
  { id: 'qtd',        label: 'QTD' },
  { id: 'ytd',        label: 'YTD' },
  { id: 'custom',     label: 'Custom' },
];

const PIE_COLORS = ['#7C3AED', '#10B981', '#F59E0B', '#3B82F6', '#06B6D4', '#EC4899'];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState('mtd');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [openTx, setOpenTx] = useState(null);
  const [clients, setClients] = useState([]);
  const [entities, setEntities] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/api/clients'), api.get('/api/entities')])
      .then(([cl, en]) => { setClients(cl.rows); setEntities(en.rows); }).catch(() => {});
  }, []);

  useEffect(() => {
    const url = period === 'custom'
      ? `/api/dashboard/summary?period=custom&from=${customFrom}&to=${customTo}`
      : `/api/dashboard/summary?period=${period}`;
    api.get(url).then(setData).catch((e) => setErr(e.message));
  }, [period, customFrom, customTo]);

  const methodPie = useMemo(() => {
    if (!data) return [];
    return data.method_mix.map((m, i) => ({ name: m.method, value: parseFloat(m.amount), color: PIE_COLORS[i % PIE_COLORS.length] }));
  }, [data]);

  const totalTxCount = data ? data.summary.tx_count : 0;
  const isAdmin = user?.role === 'super_admin';

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      {/* ROW 1: period filter + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className="fp-btn"
              style={{
                background: period === p.id ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: period === p.id ? 'white' : 'var(--text-secondary)',
                borderColor: period === p.id ? 'var(--accent)' : 'var(--border)',
              }}
            >{p.label}</button>
          ))}
          {period === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{
                  padding: '6px 10px', borderRadius: 8,
                  background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', fontSize: 13,
                }}
              />
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{
                  padding: '6px 10px', borderRadius: 8,
                  background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', fontSize: 13,
                }}
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => window.open('/api/transactions/export', '_blank')}>
            <Download size={14} /> Export
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> New transaction
          </Button>
        </div>
      </div>

      {err && <Alert tone="error" className="mb-4">{err}</Alert>}

      {/* ROW 2: KPI strip — 6 compact cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
          <KPI label="Total volume"   value={money(data.summary.gross_received)}     icon={TrendingUp}     accent="var(--accent)" />
          <KPI label="FP revenue"     value={money(data.summary.revenue)}            icon={ArrowUpRight}   accent="var(--success)" />
          <KPI label="Net to clients" value={money(data.summary.gross_received - data.summary.revenue)} icon={ArrowDownToLine} accent="var(--info)" />
          <KPI label="Paid out"       value={money(data.summary.paid_out)}           icon={Wallet}         accent="var(--warning)" />
          <KPI label="On hold"        value={`${data.summary.on_hold_count} txns`}   icon={Lock}           accent="var(--warning)" />
          <KPI label="Chargebacks"    value={`${data.summary.chargeback_count} open`} icon={AlertTriangle} accent="var(--danger)" />
        </div>
      )}

      {/* ROW 3: Two charts side by side */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <Card className="p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>Daily volume</h3>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{data.daily.length} days</span>
            </div>
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={data.daily} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <defs>
                    <linearGradient id="grad-vol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"  stopColor="#7C3AED" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="grad-rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"  stopColor="#10B981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<DarkTooltip />} />
                  <Area type="monotone" dataKey="gross"   stroke="#7C3AED" strokeWidth={2} fill="url(#grad-vol)" />
                  <Area type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} fill="url(#grad-rev)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[
              { color: '#7C3AED', label: 'Volume' },
              { color: '#10B981', label: 'Revenue' },
            ]} />
          </Card>

          <Card className="p-5">
            <h3 className="font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Payment methods</h3>
            <div className="h-48 relative">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={methodPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75} paddingAngle={2}>
                    {methodPie.map((p, i) => <Cell key={i} fill={p.color} stroke="none" />)}
                  </Pie>
                  <Tooltip content={<DarkTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{totalTxCount}</div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>txns</div>
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              {methodPie.slice(0, 5).map((p) => (
                <div key={p.name} className="flex items-center text-xs">
                  <span className="w-2 h-2 rounded-sm mr-2" style={{ background: p.color }} />
                  <span className="flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{p.name}</span>
                  <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{money(p.value)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ROW 4: Two tables side by side */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="overflow-hidden">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>Top clients</h3>
              <button onClick={() => navigate('/clients')} className="text-xs" style={{ color: 'var(--accent)' }}>View all →</button>
            </div>
            <Table>
              <Thead><Tr><Th>Client</Th><Th className="text-right">Balance</Th></Tr></Thead>
              <tbody>
                {data.top_clients.slice(0, 8).map((c) => (
                  <Tr key={c.id} clickable onClick={() => navigate('/clients')}>
                    <Td className="font-medium">{c.name}</Td>
                    <Td className="text-right font-mono" style={{ color: parseFloat(c.balance_owed) < 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                      {money(c.balance_owed)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>Recent transactions</h3>
              <button onClick={() => navigate('/transactions')} className="text-xs" style={{ color: 'var(--accent)' }}>View all →</button>
            </div>
            <Table>
              <Thead><Tr><Th>#</Th><Th>Date</Th><Th>Client</Th><Th>Type</Th><Th className="text-right">Gross</Th></Tr></Thead>
              <tbody>
                {data.recent_transactions.slice(0, 8).map((t) => (
                  <Tr key={t.id} clickable onClick={() => setOpenTx(t)}>
                    <Td className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>#{t.id}</Td>
                    <Td>{dateOnly(t.date_received)}</Td>
                    <Td>{t.client_name || '—'}</Td>
                    <Td><Badge tone={t.type === 'Received' ? 'green' : 'amber'}>{t.type}</Badge></Td>
                    <Td className="text-right font-mono">{money(t.gross_amount)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      {/* Client balances */}
      <ClientBalancesSection />

      {/* Alerts */}
      {data && (data.card_alerts.length + data.renewals.length > 0) && (
        <div className="mt-4 space-y-2">
          {data.card_alerts.length > 0 && (
            <Alert tone="warning">
              {data.card_alerts.length} {data.card_alerts.length === 1 ? 'card' : 'cards'} near limit —{' '}
              <button onClick={() => navigate('/cards')} className="underline" style={{ color: 'var(--warning)' }}>view cards</button>
            </Alert>
          )}
          {data.renewals.length > 0 && (
            <Alert tone="warning">
              {data.renewals.length} asset {data.renewals.length === 1 ? 'renewal' : 'renewals'} in 30 days —{' '}
              <button onClick={() => navigate('/assets')} className="underline" style={{ color: 'var(--warning)' }}>view assets</button>
            </Alert>
          )}
        </div>
      )}

      {/* Slide-over panels */}
      {openTx && (
        <TransactionDetail
          tx={openTx}
          clients={clients}
          entities={entities}
          onClose={() => setOpenTx(null)}
          onSaved={() => { setOpenTx(null); api.get(period === 'custom' ? `/api/dashboard/summary?period=custom&from=${customFrom}&to=${customTo}` : `/api/dashboard/summary?period=${period}`).then(setData); }}
          onDeleted={() => { setOpenTx(null); api.get(period === 'custom' ? `/api/dashboard/summary?period=custom&from=${customFrom}&to=${customTo}` : `/api/dashboard/summary?period=${period}`).then(setData); }}
        />
      )}
      {createOpen && (
        <NewTransactionModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            api.get(period === 'custom' ? `/api/dashboard/summary?period=custom&from=${customFrom}&to=${customTo}` : `/api/dashboard/summary?period=${period}`).then(setData);
          }}
        />
      )}
    </div>
  );
}

function ClientBalancesSection() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    api.get('/api/dashboard/client-balances').then(setData).catch((e) => setErr(e.message));
  }, []);
  if (err) return <Alert tone="error" className="mt-4">{err}</Alert>;
  if (!data) return null;
  const rows = data.rows || [];
  if (rows.length === 0) return null;
  const t = data.totals || {};
  return (
    <Card className="p-5 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
            Client balances
          </h3>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Net to client minus payouts and reserves held — green = we owe, red = they owe.
          </div>
        </div>
        <button onClick={() => setOpen((o) => !o)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12 }}>
          {open ? '▾ Hide' : '▸ Show'}
        </button>
      </div>
      {open && (
        <Table>
          <Thead>
            <Tr>
              <Th>Client</Th>
              <Th className="text-right">Total received</Th>
              <Th className="text-right">FP fee</Th>
              <Th className="text-right">Net earned</Th>
              <Th className="text-right">Paid out</Th>
              <Th className="text-right">Reserve held</Th>
              <Th className="text-right">Balance due</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>{r.name}</Td>
                <Td className="text-right font-mono">{money(r.total_received)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{money(r.fp_fee)}</Td>
                <Td className="text-right font-mono">{money(r.net_earned)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{money(r.paid_out)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{money(r.reserve_held)}</Td>
                <Td className="text-right font-mono" style={{
                  color: r.balance_due > 0 ? 'var(--success)' : (r.balance_due < 0 ? 'var(--danger)' : 'var(--text-primary)'),
                  fontWeight: 600,
                }}>{money(r.balance_due)}</Td>
                <Td>
                  <button onClick={() => navigate(`/reports?tab=cs&client=${r.id}`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer' }}>
                    View statement →
                  </button>
                </Td>
              </Tr>
            ))}
            <Tr>
              <Td style={{ fontWeight: 600 }}>Totals</Td>
              <Td className="text-right font-mono" style={{ fontWeight: 600 }}>{money(t.total_received)}</Td>
              <Td className="text-right font-mono" style={{ fontWeight: 600 }}>{money(t.fp_fee)}</Td>
              <Td className="text-right font-mono" style={{ fontWeight: 600 }}>{money(t.net_earned)}</Td>
              <Td className="text-right font-mono" style={{ fontWeight: 600 }}>{money(t.paid_out)}</Td>
              <Td className="text-right font-mono" style={{ fontWeight: 600 }}>{money(t.reserve_held)}</Td>
              <Td className="text-right font-mono" style={{
                fontWeight: 700,
                color: t.balance_due > 0 ? 'var(--success)' : (t.balance_due < 0 ? 'var(--danger)' : 'var(--text-primary)'),
              }}>{money(t.balance_due)}</Td>
              <Td></Td>
            </Tr>
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function KPI({ label, value, icon: Icon, accent = 'var(--accent)' }) {
  return (
    <div className="fp-kpi" style={{ borderLeftColor: accent }}>
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>{label}</div>
        <Icon size={14} style={{ color: accent, opacity: 0.7 }} />
      </div>
      <div className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function DarkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="fp-card p-3 text-xs"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
    >
      <div className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{label || payload[0]?.name}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: p.color || p.fill }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{money(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="flex items-center gap-4 mt-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span className="w-2 h-2 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </div>
      ))}
    </div>
  );
}
