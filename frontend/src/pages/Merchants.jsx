import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge, Table, Thead, Th, Tr, Td, money, pct } from '../components/ui';

const AVAIL_TONE = { available: 'green', paused: 'amber', blocked: 'red', on_hold: 'amber', restricted: 'red', closed: 'zinc' };

export default function Merchants() {
  const [rows, setRows] = useState([]);
  const [entities, setEntities] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [m, e] = await Promise.all([api.get('/api/merchants'), api.get('/api/entities')]);
      setRows(m.rows); setEntities(e.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader title="Merchants" subtitle={`${rows.length} processor accounts`} actions={<Button onClick={() => setCreateOpen(true)}>+ New merchant</Button>} />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <Card className="overflow-hidden">
        <Table>
          <Thead><Tr><Th>Processor</Th><Th>Entity</Th><Th className="text-right">Fee %</Th><Th className="text-right">Fixed</Th><Th className="text-right">CB fee</Th><Th>Methods</Th><Th>Availability</Th><Th>Risk</Th><Th></Th></Tr></Thead>
          <tbody>
            {rows.map(m => (
              <Tr key={m.id}>
                <Td className="font-medium">{m.processor_name}</Td>
                <Td className="text-[var(--text-secondary)]">{m.entity_name || '—'}</Td>
                <Td className="text-right font-mono">{pct(m.processing_fee_pct)}</Td>
                <Td className="text-right font-mono">{money(m.fixed_fee)}</Td>
                <Td className="text-right font-mono">{money(m.chargeback_fee)}</Td>
                <Td><div className="flex flex-wrap gap-1">{(m.supported_methods || []).map((s, i) => <Badge key={i} tone="blue">{s}</Badge>)}</div></Td>
                <Td><Badge tone={AVAIL_TONE[m.availability] || 'zinc'}>{m.availability}</Badge></Td>
                <Td><Badge tone={m.risk_status === 'high_risk' ? 'red' : m.risk_status === 'elevated' ? 'amber' : 'zinc'}>{m.risk_status}</Badge></Td>
                <Td><button className="text-[var(--accent)] text-xs" onClick={() => setEdit(m)}>Edit</button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {(createOpen || edit) && <MerchantForm merchant={edit} entities={entities} onClose={() => { setEdit(null); setCreateOpen(false); }} onSaved={() => { setEdit(null); setCreateOpen(false); load(); }} />}
    </div>
  );
}

function MerchantForm({ merchant, entities, onClose, onSaved }) {
  const [form, setForm] = useState(merchant || { availability: 'available', risk_status: 'normal', supported_methods: ['Debit/Credit Cards'] });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  function toggleMethod(m) {
    const curr = form.supported_methods || [];
    const next = curr.includes(m) ? curr.filter(x => x !== m) : [...curr, m];
    setForm(f => ({ ...f, supported_methods: next }));
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = { ...form,
        processing_fee_pct: parseFloat(form.processing_fee_pct) || 0,
        fixed_fee: parseFloat(form.fixed_fee) || 0,
        chargeback_fee: parseFloat(form.chargeback_fee) || 0,
        daily_limit: form.daily_limit ? parseFloat(form.daily_limit) : null,
        monthly_limit: form.monthly_limit ? parseFloat(form.monthly_limit) : null,
        entity_id: form.entity_id || null,
      };
      if (merchant) await api.patch(`/api/merchants/${merchant.id}`, body);
      else          await api.post('/api/merchants', body);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={merchant ? 'Edit merchant' : 'New merchant'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Processor</Label><Input value={form.processor_name || ''} onChange={(e) => setForm(f => ({ ...f, processor_name: e.target.value }))} /></div>
        <div><Label>Entity</Label><Select value={form.entity_id || ''} onChange={(e) => setForm(f => ({ ...f, entity_id: e.target.value }))}><option value="">—</option>{entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</Select></div>
        <div><Label>Fee %</Label><Input type="number" step="0.0001" value={form.processing_fee_pct ?? ''} onChange={(e) => setForm(f => ({ ...f, processing_fee_pct: e.target.value }))} /></div>
        <div><Label>Fixed fee</Label><Input type="number" step="0.01" value={form.fixed_fee ?? ''} onChange={(e) => setForm(f => ({ ...f, fixed_fee: e.target.value }))} /></div>
        <div><Label>Chargeback fee</Label><Input type="number" step="0.01" value={form.chargeback_fee ?? ''} onChange={(e) => setForm(f => ({ ...f, chargeback_fee: e.target.value }))} /></div>
        <div><Label>Daily limit</Label><Input type="number" value={form.daily_limit || ''} onChange={(e) => setForm(f => ({ ...f, daily_limit: e.target.value }))} /></div>
        <div><Label>Monthly limit</Label><Input type="number" value={form.monthly_limit || ''} onChange={(e) => setForm(f => ({ ...f, monthly_limit: e.target.value }))} /></div>
        <div><Label>Availability</Label><Select value={form.availability} onChange={(e) => setForm(f => ({ ...f, availability: e.target.value }))}><option>available</option><option>paused</option><option>blocked</option><option>on_hold</option><option>restricted</option><option>closed</option></Select></div>
        <div><Label>Risk</Label><Select value={form.risk_status} onChange={(e) => setForm(f => ({ ...f, risk_status: e.target.value }))}><option>normal</option><option>elevated</option><option>high_risk</option></Select></div>
        <div className="col-span-2">
          <Label>Supported methods</Label>
          <div className="flex flex-wrap gap-2">
            {['Debit/Credit Cards','ACH','Wire Transfer','Zelle','PayPal','Cheque'].map(m => (
              <label key={m} className="flex items-center gap-2 text-sm bg-[var(--bg-primary)] px-3 py-1 border border-[var(--border)] rounded">
                <input type="checkbox" checked={(form.supported_methods || []).includes(m)} onChange={() => toggleMethod(m)} />{m}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
