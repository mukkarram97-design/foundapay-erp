import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge, Table, Thead, Th, Tr, Td, money, dateOnly } from '../components/ui';

export default function Assets() {
  const [rows, setRows] = useState([]);
  const [cards, setCards] = useState([]);
  const [entities, setEntities] = useState([]);
  const [clients, setClients] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [a, c, e, cl] = await Promise.all([
        api.get('/api/assets'), api.get('/api/cards'), api.get('/api/entities'), api.get('/api/clients'),
      ]);
      setRows(a.rows); setCards(c.rows); setEntities(e.rows); setClients(cl.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader title="Assets & Domains" subtitle={`${rows.length} assets`} actions={<Button onClick={() => setCreateOpen(true)}>+ New asset</Button>} />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      <Card className="overflow-hidden">
        <Table>
          <Thead><Tr><Th>Name</Th><Th>Type</Th><Th>Vendor</Th><Th>Renewal</Th><Th>Days</Th><Th className="text-right">Annual cost</Th><Th>Card</Th><Th>Ownership</Th><Th></Th></Tr></Thead>
          <tbody>
            {rows.map(a => {
              const days = a.days_to_renewal == null ? null : Math.round(parseFloat(a.days_to_renewal));
              const tone = days == null ? 'zinc' : days < 7 ? 'red' : days < 30 ? 'amber' : 'green';
              return (
                <Tr key={a.id}>
                  <Td className="font-medium">{a.name}</Td>
                  <Td><Badge>{a.asset_type}</Badge></Td>
                  <Td className="text-[var(--text-secondary)]">{a.vendor || '—'}</Td>
                  <Td className="text-[var(--text-tertiary)] text-xs">{dateOnly(a.renewal_date)}</Td>
                  <Td>{days == null ? '—' : <Badge tone={tone}>{days >= 0 ? `${days}d` : `${-days}d ago`}</Badge>}</Td>
                  <Td className="text-right font-mono">{money(a.annual_cost)}</Td>
                  <Td className="text-[var(--text-tertiary)] text-xs">{a.card_nickname ? `${a.card_nickname} ••${a.card_last4}` : '—'}</Td>
                  <Td><Badge tone={a.ownership_type === 'client' ? 'blue' : 'zinc'}>{a.ownership_type}</Badge></Td>
                  <Td><button className="text-[var(--accent)] text-xs" onClick={() => setEdit(a)}>Edit</button></Td>
                </Tr>
              );
            })}
            {rows.length === 0 && <Tr><Td colSpan="9"><span className="text-[var(--text-tertiary)]">No assets yet</span></Td></Tr>}
          </tbody>
        </Table>
      </Card>
      {(createOpen || edit) && (
        <AssetForm asset={edit} cards={cards} entities={entities} clients={clients}
          onClose={() => { setEdit(null); setCreateOpen(false); }}
          onSaved={() => { setEdit(null); setCreateOpen(false); load(); }} />
      )}
    </div>
  );
}

function AssetForm({ asset, cards, entities, clients, onClose, onSaved }) {
  const [form, setForm] = useState(asset || { asset_type: 'domain', ownership_type: 'internal', is_recurring: true, status: 'active' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = { ...form,
        purchase_amount: form.purchase_amount ? parseFloat(form.purchase_amount) : null,
        annual_cost: form.annual_cost ? parseFloat(form.annual_cost) : null,
        card_id: form.card_id || null, entity_id: form.entity_id || null, client_id: form.client_id || null,
      };
      if (asset) await api.patch(`/api/assets/${asset.id}`, body);
      else       await api.post('/api/assets', body);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={asset ? 'Edit asset' : 'New asset'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Name</Label><Input value={form.name || ''} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
        <div><Label>Type</Label><Select value={form.asset_type} onChange={(e) => setForm(f => ({ ...f, asset_type: e.target.value }))}>
          <option>domain</option><option>vps</option><option>hosting</option><option>software_license</option><option>hardware</option><option>tool</option><option>subscription_seat</option><option>other</option>
        </Select></div>
        <div><Label>Vendor</Label><Input value={form.vendor || ''} onChange={(e) => setForm(f => ({ ...f, vendor: e.target.value }))} /></div>
        <div><Label>Renewal date</Label><Input type="date" value={dateOnly(form.renewal_date) === '—' ? '' : dateOnly(form.renewal_date)} onChange={(e) => setForm(f => ({ ...f, renewal_date: e.target.value }))} /></div>
        <div><Label>Annual cost</Label><Input type="number" value={form.annual_cost || ''} onChange={(e) => setForm(f => ({ ...f, annual_cost: e.target.value }))} /></div>
        <div><Label>Card</Label><Select value={form.card_id || ''} onChange={(e) => setForm(f => ({ ...f, card_id: e.target.value }))}><option value="">—</option>{cards.map(c => <option key={c.id} value={c.id}>{c.nickname} ••{c.last4}</option>)}</Select></div>
        <div><Label>Entity</Label><Select value={form.entity_id || ''} onChange={(e) => setForm(f => ({ ...f, entity_id: e.target.value }))}><option value="">—</option>{entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</Select></div>
        <div><Label>Ownership</Label><Select value={form.ownership_type} onChange={(e) => setForm(f => ({ ...f, ownership_type: e.target.value }))}><option>internal</option><option>client</option><option>shared</option></Select></div>
        {form.ownership_type !== 'internal' && (
          <div className="col-span-2"><Label>Client</Label><Select value={form.client_id || ''} onChange={(e) => setForm(f => ({ ...f, client_id: e.target.value }))}><option value="">—</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        )}
      </div>
    </Modal>
  );
}
