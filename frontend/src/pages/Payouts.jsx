import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge, Table, Thead, Th, Tr, Td, money, dateOnly } from '../components/ui';

const STAGES = ['prepared','finance_review','admin_approval','approved','sent','proof_uploaded','closed'];

export default function Payouts() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [p, c] = await Promise.all([api.get('/api/payouts'), api.get('/api/clients')]);
      setRows(p.rows); setClients(c.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const counts = STAGES.reduce((a, s) => ({ ...a, [s]: rows.filter(r => r.status === s).length }), {});

  async function advance(id) { await api.post(`/api/payouts/${id}/advance`, {}); load(); }
  async function reject(id) { const reason = prompt('Reason?'); if (reason !== null) { await api.post(`/api/payouts/${id}/reject`, { reason }); load(); } }

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader title="Payouts" subtitle="7-stage approval workflow" actions={<Button onClick={() => setCreateOpen(true)}>+ New payout</Button>} />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          {STAGES.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex flex-col items-center min-w-[110px]">
                <div className="text-[10px] uppercase text-[var(--text-tertiary)]">{s.replace(/_/g, ' ')}</div>
                <div className="text-xl font-semibold text-[var(--text-primary)] mt-0.5">{counts[s] || 0}</div>
              </div>
              {i < STAGES.length - 1 && <span className="text-[var(--text-tertiary)]">›</span>}
            </React.Fragment>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <Thead><Tr><Th>Date</Th><Th>Client</Th><Th>Method</Th><Th>Country</Th><Th className="text-right">Amount</Th><Th>Reference</Th><Th>Status</Th><Th></Th></Tr></Thead>
          <tbody>
            {rows.map(p => (
              <Tr key={p.id}>
                <Td>{dateOnly(p.created_at)}</Td>
                <Td>{p.client_name}</Td>
                <Td className="text-[var(--text-secondary)]">{p.payout_method || '—'}</Td>
                <Td className="text-[var(--text-tertiary)] text-xs">{p.country || '—'}</Td>
                <Td className="text-right font-mono">{money(p.amount, p.currency || 'USD')}</Td>
                <Td className="font-mono text-[var(--text-tertiary)] text-xs">{p.reference_number || '—'}</Td>
                <Td><Badge tone="blue">{p.status}</Badge></Td>
                <Td>
                  <div className="flex gap-2 text-xs">
                    {p.status !== 'closed' && p.status !== 'rejected' && <button className="text-emerald-400" onClick={() => advance(p.id)}>Advance</button>}
                    {p.status !== 'closed' && p.status !== 'rejected' && <button className="text-red-400" onClick={() => reject(p.id)}>Reject</button>}
                    <button className="text-[var(--accent)]" onClick={() => setEdit(p)}>Edit</button>
                  </div>
                </Td>
              </Tr>
            ))}
            {rows.length === 0 && <Tr><Td colSpan="8"><span className="text-[var(--text-tertiary)]">No payouts yet</span></Td></Tr>}
          </tbody>
        </Table>
      </Card>
      {(createOpen || edit) && <PayoutForm payout={edit} clients={clients} onClose={() => { setEdit(null); setCreateOpen(false); }} onSaved={() => { setEdit(null); setCreateOpen(false); load(); }} />}
    </div>
  );
}

function PayoutForm({ payout, clients, onClose, onSaved }) {
  const [form, setForm] = useState(payout || { currency: 'USD', payout_method: 'Bank Wire' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = { ...form,
        amount: parseFloat(form.amount) || 0,
        exchange_rate: form.exchange_rate ? parseFloat(form.exchange_rate) : null,
        transfer_fee: form.transfer_fee ? parseFloat(form.transfer_fee) : null,
      };
      if (payout) await api.patch(`/api/payouts/${payout.id}`, body);
      else        await api.post('/api/payouts', body);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={payout ? `Edit payout` : 'New payout'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Client</Label><Select value={form.client_id || ''} onChange={(e) => setForm(f => ({ ...f, client_id: e.target.value }))}><option value="">—</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount || ''} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
        <div><Label>Currency</Label><Select value={form.currency} onChange={(e) => setForm(f => ({ ...f, currency: e.target.value }))}><option>USD</option><option>PKR</option><option>EUR</option><option>GBP</option></Select></div>
        <div><Label>Country</Label><Input value={form.country || ''} onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))} /></div>
        <div><Label>Method</Label><Select value={form.payout_method || ''} onChange={(e) => setForm(f => ({ ...f, payout_method: e.target.value }))}><option>Bank Wire</option><option>ACH</option><option>Zelle</option><option>Wise</option><option>PayPal</option><option>Crypto USDT</option><option>Cash</option><option>Cheque</option></Select></div>
        <div><Label>Recipient name</Label><Input value={form.recipient_name || ''} onChange={(e) => setForm(f => ({ ...f, recipient_name: e.target.value }))} /></div>
        <div><Label>Exchange rate</Label><Input type="number" step="0.01" value={form.exchange_rate || ''} onChange={(e) => setForm(f => ({ ...f, exchange_rate: e.target.value }))} /></div>
        <div><Label>Transfer fee</Label><Input type="number" step="0.01" value={form.transfer_fee || ''} onChange={(e) => setForm(f => ({ ...f, transfer_fee: e.target.value }))} /></div>
        <div className="col-span-2"><Label>Reference number</Label><Input value={form.reference_number || ''} onChange={(e) => setForm(f => ({ ...f, reference_number: e.target.value }))} /></div>
        <div className="col-span-2"><Label>Notes</Label><Input value={form.notes || ''} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}
