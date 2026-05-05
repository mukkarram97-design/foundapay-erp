import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../utils/api';
import { Card, PageHeader, Alert, money } from '../components/ui';

export default function Q1Report() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.get('/api/reports/q1-2026').then(setData).catch((e) => setErr(e.message)); }, []);

  if (err) return <div className="p-6"><Alert tone="error">{err}</Alert></div>;
  if (!data) return <div className="p-6"><Card className="p-6 text-[var(--text-tertiary)]">Loading…</Card></div>;

  const months = [
    { month: 'Jan', gross: data.reconciled.jan.gross, revenue: data.reconciled.jan.revenue },
    { month: 'Feb', gross: data.reconciled.feb.gross, revenue: data.reconciled.feb.revenue },
    { month: 'Mar', gross: data.reconciled.mar.gross, revenue: data.reconciled.mar.revenue },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader title="Q1 2026" subtitle="Consolidated Jan + Feb + Mar" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Big label="Q1 Gross Processed" value={money(data.reconciled.total_gross)} />
        <Big label="Q1 FoundaPay Revenue" value={money(data.reconciled.total_revenue)} tone="green" />
        <Big label="Q1 Net Profit" value={money(data.reconciled.net_profit)} tone="green" sub="after tax 5%, COR, OpEx" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        {months.map(m => (
          <Card key={m.month} className="p-5">
            <div className="text-[var(--text-secondary)] text-sm font-medium mb-3">{m.month} 2026</div>
            <div className="text-xs text-[var(--text-tertiary)]">Gross</div>
            <div className="text-xl font-semibold text-[var(--text-primary)]">{money(m.gross)}</div>
            <div className="text-xs text-[var(--text-tertiary)] mt-2">Revenue</div>
            <div className="text-xl font-semibold text-emerald-400">{money(m.revenue)}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5 mb-6">
        <h3 className="font-medium text-[var(--text-primary)] mb-3">Monthly volume</h3>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={months}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="month" tick={{ fill: '#a1a1aa' }} />
              <YAxis tick={{ fill: '#71717a', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46' }} />
              <Bar dataKey="gross" fill="#2563eb" />
              <Bar dataKey="revenue" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-medium text-[var(--text-primary)] mb-3">Chargeback summary</h3>
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div><div className="text-xs text-[var(--text-tertiary)]">Jan</div><div className="text-[var(--text-primary)] font-semibold">{data.reconciled.cb_breakdown.jan}</div></div>
          <div><div className="text-xs text-[var(--text-tertiary)]">Feb</div><div className="text-[var(--text-primary)] font-semibold">{data.reconciled.cb_breakdown.feb}</div></div>
          <div><div className="text-xs text-[var(--text-tertiary)]">Mar</div><div className="text-[var(--text-primary)] font-semibold">{data.reconciled.cb_breakdown.mar}</div></div>
          <div><div className="text-xs text-[var(--text-tertiary)]">Q1 Total</div><div className="text-[var(--text-primary)] font-semibold">{data.reconciled.chargebacks}</div></div>
        </div>
        <p className="text-[var(--text-tertiary)] text-xs mt-3">CB fees ($45 Authorize, $25 PaymentCloud) charged to client — not FP revenue.</p>
      </Card>
    </div>
  );
}

function Big({ label, value, sub, tone = 'zinc' }) {
  const tones = { zinc: 'text-[var(--text-primary)]', green: 'text-emerald-400' };
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-[var(--text-tertiary)] mt-1">{sub}</div>}
    </Card>
  );
}
