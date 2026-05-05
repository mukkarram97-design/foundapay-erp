import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, PageHeader, Alert, Badge, Table, Thead, Th, Tr, Td, money, dateOnly } from '../components/ui';

export default function Salary() {
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [details, setDetails] = useState(null);
  const [err, setErr] = useState(null);

  async function loadList() {
    try {
      const r = await api.get('/api/salary');
      setList(r.rows);
      if (r.rows.length && !active) {
        setActive(r.rows[0].id);
      }
    } catch (e) { setErr(e.message); }
  }

  async function loadDetails(id) {
    if (!id) return;
    const r = await api.get(`/api/salary/${id}`);
    setDetails(r);
  }

  useEffect(() => { loadList(); }, []);
  useEffect(() => { loadDetails(active); /* eslint-disable-next-line */ }, [active]);

  async function approve() { await api.patch(`/api/salary/${active}/approve`, {}); loadDetails(active); loadList(); }
  async function markDisbursed() { await api.patch(`/api/salary/${active}/mark-disbursed`, {}); loadDetails(active); loadList(); }
  async function markItemPaid(itemId) { await api.patch(`/api/salary/${active}/items/${itemId}/paid`, {}); loadDetails(active); }

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader title="Salary" />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-3">
          <h3 className="font-medium text-[var(--text-primary)] mb-2 text-sm">Disbursements</h3>
          <div className="space-y-1">
            {list.map(d => (
              <button
                key={d.id}
                onClick={() => setActive(d.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm ${active === d.id ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
              >
                <div className="font-medium">{d.period}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{money(d.total_usd)} · {d.items_count} payees</div>
                <Badge tone={d.status === 'disbursed' ? 'green' : d.status === 'approved' ? 'blue' : 'zinc'} className="mt-1">{d.status}</Badge>
              </button>
            ))}
          </div>
        </Card>

        <div className="md:col-span-3 space-y-4">
          {!details && <Card className="p-6 text-[var(--text-tertiary)]">Pick a disbursement…</Card>}
          {details && (
            <>
              <Card className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">{details.disbursement.period}</h2>
                    <div className="text-[var(--text-tertiary)] text-sm">Pay date: {dateOnly(details.disbursement.pay_date)}</div>
                  </div>
                  <div className="flex gap-2">
                    {details.disbursement.status === 'draft' && <Button onClick={approve}>Approve</Button>}
                    {details.disbursement.status === 'approved' && <Button onClick={markDisbursed}>Mark disbursed</Button>}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <Stat label="Total USD" value={money(details.disbursement.total_usd)} tone="green" />
                  <Stat label="Total PKR" value={money(details.disbursement.total_pkr, 'PKR')} />
                  <Stat label="FX rate" value={`${details.disbursement.exchange_rate} PKR / USD`} />
                </div>
              </Card>

              <Card className="overflow-hidden">
                <Table>
                  <Thead><Tr><Th>Employee</Th><Th>Bank</Th><Th>Account</Th><Th className="text-right">USD</Th><Th className="text-right">PKR</Th><Th>Status</Th><Th></Th></Tr></Thead>
                  <tbody>
                    {details.items.map(it => (
                      <Tr key={it.id}>
                        <Td className="font-medium">{it.employee_name}<div className="text-xs text-[var(--text-tertiary)]">{it.full_name}</div></Td>
                        <Td className="text-[var(--text-secondary)]">{it.bank_name}</Td>
                        <Td className="text-[var(--text-tertiary)] font-mono text-xs">{it.account_number}</Td>
                        <Td className="text-right font-mono">{money(it.amount_usd)}</Td>
                        <Td className="text-right font-mono">{money(it.amount_pkr, 'PKR')}</Td>
                        <Td><Badge tone={it.status === 'paid' ? 'green' : 'zinc'}>{it.status}</Badge></Td>
                        <Td>{it.status !== 'paid' && <button className="text-emerald-400 text-xs" onClick={() => markItemPaid(it.id)}>Mark paid</button>}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'zinc' }) {
  const tones = { zinc: 'text-[var(--text-primary)]', green: 'text-emerald-400', amber: 'text-amber-400' };
  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{label}</div>
      <div className={`text-base font-semibold ${tones[tone]}`}>{value}</div>
    </div>
  );
}
