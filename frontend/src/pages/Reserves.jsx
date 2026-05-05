import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, PageHeader, Alert, Badge, Select, Table, Thead, Th, Tr, Td, money, dateOnly } from '../components/ui';

export default function Reserves() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const r = await api.get(`/api/reserves${status ? `?status=${status}` : ''}`);
      setRows(r.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function release(id) {
    await api.post(`/api/reserves/${id}/release`, {});
    load();
  }

  const totals = rows.reduce((a, r) => {
    a.held += parseFloat(r.amount) - parseFloat(r.released_amount || 0);
    a.released += parseFloat(r.released_amount || 0);
    return a;
  }, { held: 0, released: 0 });

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader title="Reserves" subtitle={`Held: ${money(totals.held)} · Released: ${money(totals.released)}`} />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <Card className="p-3 mb-4 flex items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All statuses</option>
          <option>held</option><option>partially_released</option><option>released</option><option>forfeited</option>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <Thead><Tr><Th>Hold date</Th><Th>Release date</Th><Th>Client</Th><Th>Processor</Th><Th>Type</Th><Th className="text-right">Amount</Th><Th className="text-right">Released</Th><Th>Status</Th><Th></Th></Tr></Thead>
          <tbody>
            {rows.map(r => (
              <Tr key={r.id}>
                <Td>{dateOnly(r.hold_date)}</Td>
                <Td>{dateOnly(r.release_date)}</Td>
                <Td>{r.client_name || '—'}</Td>
                <Td className="text-[var(--text-secondary)]">{r.processor_name || '—'}</Td>
                <Td className="text-[var(--text-tertiary)] text-xs">{r.reserve_type || '—'}</Td>
                <Td className="text-right font-mono">{money(r.amount)}</Td>
                <Td className="text-right font-mono text-[var(--text-secondary)]">{money(r.released_amount)}</Td>
                <Td><Badge tone={r.status === 'released' ? 'green' : r.status === 'partially_released' ? 'amber' : 'blue'}>{r.status}</Badge></Td>
                <Td>{r.status !== 'released' && <button className="text-emerald-400 text-xs" onClick={() => release(r.id)}>Release</button>}</Td>
              </Tr>
            ))}
            {rows.length === 0 && <Tr><Td colSpan="9"><span className="text-[var(--text-tertiary)]">No reserves</span></Td></Tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
