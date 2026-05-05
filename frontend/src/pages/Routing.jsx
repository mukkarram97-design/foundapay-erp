import React, { useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Alert, Badge, Table, Thead, Th, Tr, Td, money, pct } from '../components/ui';

export default function Routing() {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Debit/Credit Cards');
  const [results, setResults] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  async function run(e) {
    e.preventDefault();
    setErr(null); setLoading(true);
    try {
      const r = await api.post('/api/merchants/route', { amount: parseFloat(amount), method });
      setResults(r.ranked);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <PageHeader title="Auto-Routing" subtitle="Rank merchants for a transaction" />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <Card className="p-5 mb-4">
        <form onSubmit={run} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div><Label>Amount</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
          <div><Label>Method</Label><Select value={method} onChange={(e) => setMethod(e.target.value)}><option>Debit/Credit Cards</option><option>ACH</option><option>Wire Transfer</option><option>Zelle</option><option>PayPal</option></Select></div>
          <Button type="submit" disabled={loading}>{loading ? 'Ranking…' : 'Find best route'}</Button>
        </form>
      </Card>

      {results.length > 0 && (
        <Card className="overflow-hidden">
          <Table>
            <Thead><Tr><Th>Rank</Th><Th>Score</Th><Th>Processor</Th><Th>Entity</Th><Th>Risk</Th><Th className="text-right">Fee %</Th><Th className="text-right">Daily limit</Th><Th>Methods</Th></Tr></Thead>
            <tbody>
              {results.map((r, i) => (
                <Tr key={r.id}>
                  <Td className="font-semibold text-[var(--text-primary)]">{i + 1}</Td>
                  <Td><Badge tone={r._score > 70 ? 'green' : r._score > 40 ? 'amber' : 'red'}>{r._score}</Badge></Td>
                  <Td className="font-medium">{r.processor_name}</Td>
                  <Td className="text-[var(--text-secondary)]">{r.entity_name || '—'}</Td>
                  <Td><Badge tone={r.risk_status === 'high_risk' ? 'red' : r.risk_status === 'elevated' ? 'amber' : 'zinc'}>{r.risk_status}</Badge></Td>
                  <Td className="text-right font-mono">{pct(r.processing_fee_pct)}</Td>
                  <Td className="text-right font-mono">{r.daily_limit ? money(r.daily_limit) : '—'}</Td>
                  <Td><div className="flex flex-wrap gap-1">{(r.supported_methods || []).map((m, j) => <Badge key={j} tone="blue">{m}</Badge>)}</div></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
