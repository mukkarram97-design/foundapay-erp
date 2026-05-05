import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge, Table, Thead, Th, Tr, Td, money } from '../components/ui';

export default function Entities() {
  const [rows, setRows] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try { const r = await api.get('/api/entities'); setRows(r.rows); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader title="Entities" subtitle={`${rows.length} legal entities`} actions={<Button onClick={() => setCreateOpen(true)}>+ New entity</Button>} />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      <Card className="overflow-hidden">
        <Table>
          <Thead><Tr><Th>Legal name</Th><Th>Owner / Partner</Th><Th>EIN reference</Th><Th>Banks</Th><Th className="text-right">MTD volume</Th><Th>Status</Th><Th></Th></Tr></Thead>
          <tbody>
            {rows.map(e => (
              <Tr key={e.id}>
                <Td className="font-medium">{e.legal_name}</Td>
                <Td className="text-[var(--text-secondary)]">{e.owner_name || e.partner_name || '—'}</Td>
                <Td className="font-mono text-[var(--text-tertiary)] text-xs">{e.ein_reference}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {(e.banks || []).map((b, i) => (
                      <span key={i} className="text-xs bg-[var(--bg-tertiary)] px-2 py-0.5 rounded">{b.bank} · {money(b.balance)}</span>
                    ))}
                    {(!e.banks || e.banks.length === 0) && <span className="text-[var(--text-tertiary)] text-xs">—</span>}
                  </div>
                </Td>
                <Td className="text-right font-mono">{money(e.mtd_volume)}</Td>
                <Td><Badge tone={e.status === 'active' ? 'green' : 'zinc'}>{e.status}</Badge></Td>
                <Td><button className="text-[var(--accent)] text-xs" onClick={() => setEdit(e)}>Edit</button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {(createOpen || edit) && <EntityForm entity={edit} onClose={() => { setEdit(null); setCreateOpen(false); }} onSaved={() => { setEdit(null); setCreateOpen(false); load(); }} />}
    </div>
  );
}

function EntityForm({ entity, onClose, onSaved }) {
  const [form, setForm] = useState(entity || { entity_type: 'LLC', status: 'active' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      if (entity) await api.patch(`/api/entities/${entity.id}`, form);
      else        await api.post('/api/entities', form);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={entity ? `Edit ${entity.legal_name}` : 'New entity'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Legal name</Label><Input value={form.legal_name || ''} onChange={(e) => setForm(f => ({ ...f, legal_name: e.target.value }))} required /></div>
        <div><Label>Type</Label><Select value={form.entity_type} onChange={(e) => setForm(f => ({ ...f, entity_type: e.target.value }))}><option>LLC</option><option>Inc</option><option>Corp</option><option>Other</option></Select></div>
        <div><Label>Status</Label><Select value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}><option>active</option><option>inactive</option></Select></div>
        <div><Label>Owner</Label><Input value={form.owner_name || ''} onChange={(e) => setForm(f => ({ ...f, owner_name: e.target.value }))} /></div>
        <div><Label>Partner</Label><Input value={form.partner_name || ''} onChange={(e) => setForm(f => ({ ...f, partner_name: e.target.value }))} /></div>
        <div className="col-span-2"><Label>EIN reference</Label><Input value={form.ein_reference || ''} onChange={(e) => setForm(f => ({ ...f, ein_reference: e.target.value }))} /></div>
        <div className="col-span-2"><Label>Address</Label><Input value={form.address || ''} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}
