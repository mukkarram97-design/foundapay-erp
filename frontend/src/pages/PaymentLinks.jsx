import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge, Table, Thead, Th, Tr, Td, money, dateOnly } from '../components/ui';

export default function PaymentLinks() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [entities, setEntities] = useState([]);
  const [merchants, setMerchants] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [pl, c, e, m] = await Promise.all([
        api.get('/api/payment-links'), api.get('/api/clients'), api.get('/api/entities'), api.get('/api/merchants'),
      ]);
      setRows(pl.rows); setClients(c.rows); setEntities(e.rows); setMerchants(m.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader title="Payment Links" actions={<Button onClick={() => setCreateOpen(true)}>+ New request</Button>} />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <Card className="overflow-hidden">
        <Table>
          <Thead><Tr><Th>#</Th><Th>Date</Th><Th>Client</Th><Th>Customer</Th><Th className="text-right">Amount</Th><Th>Method</Th><Th>Entity</Th><Th>Status</Th><Th></Th></Tr></Thead>
          <tbody>
            {rows.map(r => (
              <Tr key={r.id}>
                <Td className="text-[var(--text-tertiary)] text-xs">#{r.request_number}</Td>
                <Td>{dateOnly(r.created_at)}</Td>
                <Td>{r.client_name}</Td>
                <Td>{r.customer_name} {r.customer_email && <span className="text-[var(--text-tertiary)] text-xs">· {r.customer_email}</span>}</Td>
                <Td className="text-right font-mono">{money(r.amount)}</Td>
                <Td className="text-[var(--text-secondary)] text-xs">{r.payment_method || '—'}</Td>
                <Td className="text-[var(--text-secondary)] text-xs">{r.entity_name || '—'}</Td>
                <Td><Badge tone="blue">{r.status}</Badge></Td>
                <Td><button className="text-[var(--accent)] text-xs" onClick={() => setEdit(r)}>Open</button></Td>
              </Tr>
            ))}
            {rows.length === 0 && <Tr><Td colSpan="9"><span className="text-[var(--text-tertiary)]">No payment link requests</span></Td></Tr>}
          </tbody>
        </Table>
      </Card>

      {(createOpen || edit) && <PLForm pl={edit} clients={clients} entities={entities} merchants={merchants} onClose={() => { setEdit(null); setCreateOpen(false); }} onSaved={() => { setEdit(null); setCreateOpen(false); load(); }} />}
    </div>
  );
}

function PLForm({ pl, clients, entities, merchants, onClose, onSaved }) {
  const [form, setForm] = useState(pl || { currency: 'USD', payment_method: 'Debit/Credit Cards', status: 'requested' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = { ...form, amount: parseFloat(form.amount) || 0,
        client_id: form.client_id || null, entity_id: form.entity_id || null, merchant_id: form.merchant_id || null };
      if (pl) await api.patch(`/api/payment-links/${pl.id}`, body);
      else    await api.post('/api/payment-links', body);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={pl ? `Payment link #${pl.request_number}` : 'New payment link'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Client</Label><Select value={form.client_id || ''} onChange={(e) => setForm(f => ({ ...f, client_id: e.target.value }))}><option value="">—</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount || ''} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
        <div><Label>Customer name</Label><Input value={form.customer_name || ''} onChange={(e) => setForm(f => ({ ...f, customer_name: e.target.value }))} /></div>
        <div><Label>Customer email</Label><Input type="email" value={form.customer_email || ''} onChange={(e) => setForm(f => ({ ...f, customer_email: e.target.value }))} /></div>
        <div><Label>Method</Label><Select value={form.payment_method} onChange={(e) => setForm(f => ({ ...f, payment_method: e.target.value }))}><option>Debit/Credit Cards</option><option>ACH</option><option>Wire Transfer</option><option>Zelle</option><option>PayPal</option></Select></div>
        <div><Label>Entity</Label><Select value={form.entity_id || ''} onChange={(e) => setForm(f => ({ ...f, entity_id: e.target.value }))}><option value="">—</option>{entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</Select></div>
        <div><Label>Merchant</Label><Select value={form.merchant_id || ''} onChange={(e) => setForm(f => ({ ...f, merchant_id: e.target.value }))}><option value="">—</option>{merchants.map(m => <option key={m.id} value={m.id}>{m.processor_name}</option>)}</Select></div>
        <div><Label>Status</Label><Select value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
          <option>requested</option><option>assigned</option><option>merchant_selected</option><option>link_generated</option>
          <option>sent_to_client</option><option>sent_to_customer</option><option>waiting_payment</option>
          <option>paid</option><option>failed</option><option>cancelled</option><option>refunded</option>
        </Select></div>
        <div className="col-span-2"><Label>Description</Label><Input value={form.description || ''} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        <div className="col-span-2"><Label>Processor link</Label><Input value={form.processor_link || ''} onChange={(e) => setForm(f => ({ ...f, processor_link: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}
