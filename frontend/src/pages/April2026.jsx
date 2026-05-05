import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, PageHeader, Alert, Badge, Table, Thead, Th, Tr, Td, money, dateOnly } from '../components/ui';

export default function April2026() {
  const [data, setData] = useState(null);
  const [tx, setTx] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/api/reports/april-2026'),
      api.get('/api/transactions?from=2026-04-01&to=2026-04-30'),
    ]).then(([r, t]) => { setData(r); setTx(t.rows); })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="p-6"><Alert tone="error">{err}</Alert></div>;
  if (!data) return <div className="p-6"><Card className="p-6 text-[var(--text-tertiary)]">Loading…</Card></div>;

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader title="April 2026" subtitle={`${tx.length} transactions in DB · 436 total reconciled`} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Big label="Gross Processed" value={money(data.reconciled.gross)} />
        <Big label="FP Revenue" value={money(data.reconciled.revenue)} tone="green" />
        <Big label="Paid Out" value={money(data.reconciled.paid_out)} tone="amber" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Card className="p-5">
          <div className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">In database</div>
          <div className="text-[var(--text-secondary)] text-sm mt-2">Transactions: <span className="font-semibold text-[var(--text-primary)]">{data.db.tx_count}</span></div>
          <div className="text-[var(--text-secondary)] text-sm">Gross: <span className="font-mono">{money(data.db.gross)}</span></div>
          <div className="text-[var(--text-secondary)] text-sm">Revenue: <span className="font-mono">{money(data.db.revenue)}</span></div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">Reconciled (truth)</div>
          <div className="text-[var(--text-secondary)] text-sm mt-2">Transactions: <span className="font-semibold text-[var(--text-primary)]">{data.reconciled.tx_count}</span></div>
          <div className="text-[var(--text-secondary)] text-sm">Gross: <span className="font-mono">{money(data.reconciled.gross)}</span></div>
          <div className="text-[var(--text-secondary)] text-sm">Revenue: <span className="font-mono">{money(data.reconciled.revenue)}</span></div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-amber-500 uppercase tracking-wider">Backfill needed</div>
          <div className="text-[var(--text-secondary)] text-sm mt-2">{data.reconciled.tx_count - data.db.tx_count} transactions to import</div>
          <div className="text-[var(--text-tertiary)] text-xs mt-2">Use <span className="text-[var(--text-secondary)] font-mono">POST /api/transactions/bulk-import</span></div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead><Tr><Th>#</Th><Th>Date</Th><Th>Type</Th><Th>Client</Th><Th>Method</Th><Th>Entity</Th><Th>Processor</Th><Th className="text-right">Gross</Th><Th className="text-right">Net</Th><Th>Status</Th></Tr></Thead>
          <tbody>
            {tx.map(t => (
              <Tr key={t.id}>
                <Td className="text-[var(--text-tertiary)] text-xs">#{t.id}</Td>
                <Td>{dateOnly(t.date_received)}</Td>
                <Td><Badge tone={t.type === 'Received' ? 'green' : 'amber'}>{t.type}</Badge></Td>
                <Td>{t.client_name || t.counterparty_name || '—'}</Td>
                <Td className="text-[var(--text-secondary)] text-xs">{t.payment_method || '—'}</Td>
                <Td className="text-[var(--text-secondary)] text-xs">{t.entity_name || '—'}</Td>
                <Td className="text-[var(--text-secondary)] text-xs">{t.processor_name || '—'}</Td>
                <Td className="text-right font-mono">{money(t.gross_amount)}</Td>
                <Td className="text-right font-mono">{money(t.net_amount)}</Td>
                <Td><Badge>{t.status}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function Big({ label, value, tone = 'zinc' }) {
  const tones = { zinc: 'text-[var(--text-primary)]', green: 'text-emerald-400', amber: 'text-amber-400' };
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${tones[tone]}`}>{value}</div>
    </Card>
  );
}
