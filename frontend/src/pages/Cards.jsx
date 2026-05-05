import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge, Table, Thead, Th, Tr, Td, money } from '../components/ui';

export default function Cards() {
  const [rows, setRows] = useState([]);
  const [entities, setEntities] = useState([]);
  const [edit, setEdit] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [c, e] = await Promise.all([api.get('/api/cards'), api.get('/api/entities')]);
      setRows(c.rows); setEntities(e.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!filter) return rows;
    const q = filter.toLowerCase();
    return rows.filter(c =>
      (c.nickname || '').toLowerCase().includes(q) ||
      (c.last4 || '').includes(q) ||
      (c.bank_name || '').toLowerCase().includes(q) ||
      (c.entity_name || '').toLowerCase().includes(q)
    );
  }, [rows, filter]);

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Cards"
        subtitle={`${rows.length} cards across ${entities.length} entities`}
        actions={<Button onClick={() => setCreateOpen(true)}>+ New card</Button>}
      />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <Card className="p-3 mb-4">
        <Input placeholder="Filter by nickname, last 4, bank, or entity..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr>
              <Th>Nickname</Th><Th>Last 4</Th><Th>Type</Th><Th>Bank</Th>
              <Th>Entity</Th><Th>Holder</Th><Th>Expiry</Th>
              <Th className="text-right">MTD Spend</Th><Th>Limit</Th><Th>Status</Th><Th></Th>
            </Tr>
          </Thead>
          <tbody>
            {filtered.map(c => {
              const limit = parseFloat(c.monthly_limit || 0);
              const spend = parseFloat(c.mtd_spend || 0);
              const pct = limit ? Math.min(100, (spend / limit) * 100) : 0;
              const overThreshold = limit && pct >= (c.alert_threshold_pct || 80);
              return (
                <Tr key={c.id}>
                  <Td>{c.nickname || '—'}</Td>
                  <Td className="font-mono text-[var(--text-secondary)]">••{c.last4 || '—'}</Td>
                  <Td><Badge tone={c.card_type === 'physical' ? 'blue' : 'violet'}>{c.card_type}</Badge></Td>
                  <Td className="text-[var(--text-secondary)]">{c.bank_name}</Td>
                  <Td className="text-[var(--text-secondary)] text-xs">{c.entity_name || '—'}</Td>
                  <Td className="text-[var(--text-secondary)] text-xs">{c.cardholder_name || '—'}</Td>
                  <Td className="text-[var(--text-tertiary)] text-xs">{c.expiry || '—'}</Td>
                  <Td className="text-right font-mono">{money(spend)}</Td>
                  <Td>
                    {limit ? (
                      <div className="w-32">
                        <div className="text-xs text-[var(--text-tertiary)]">{money(limit)}</div>
                        <div className="h-1 bg-[var(--bg-tertiary)] rounded mt-1">
                          <div className={`h-1 rounded ${overThreshold ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ) : <span className="text-[var(--text-tertiary)]">—</span>}
                  </Td>
                  <Td><Badge tone={c.status === 'active' ? 'green' : 'zinc'}>{c.status}</Badge></Td>
                  <Td><button className="text-[var(--accent)] text-xs" onClick={() => setEdit(c)}>Edit</button></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {(createOpen || edit) && (
        <CardForm
          card={edit}
          entities={entities}
          onClose={() => { setEdit(null); setCreateOpen(false); }}
          onSaved={() => { setEdit(null); setCreateOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function CardForm({ card, entities, onClose, onSaved }) {
  const [form, setForm] = useState(card || { card_type: 'virtual', status: 'active', alert_threshold_pct: 80 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = {
        ...form,
        monthly_limit: form.monthly_limit ? parseFloat(form.monthly_limit) : null,
        alert_threshold_pct: parseInt(form.alert_threshold_pct || 80, 10),
        entity_id: form.entity_id || null,
      };
      if (card) await api.patch(`/api/cards/${card.id}`, body);
      else      await api.post('/api/cards', body);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={card ? 'Edit card' : 'New card'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Nickname</Label><Input value={form.nickname || ''} onChange={(e) => setForm(f => ({ ...f, nickname: e.target.value }))} /></div>
        <div><Label>Last 4</Label><Input maxLength={4} value={form.last4 || ''} onChange={(e) => setForm(f => ({ ...f, last4: e.target.value }))} /></div>
        <div><Label>Type</Label><Select value={form.card_type} onChange={(e) => setForm(f => ({ ...f, card_type: e.target.value }))}><option>virtual</option><option>physical</option></Select></div>
        <div><Label>Bank</Label><Input value={form.bank_name || ''} onChange={(e) => setForm(f => ({ ...f, bank_name: e.target.value }))} /></div>
        <div><Label>Entity</Label><Select value={form.entity_id || ''} onChange={(e) => setForm(f => ({ ...f, entity_id: e.target.value }))}><option value="">—</option>{entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</Select></div>
        <div><Label>Cardholder</Label><Input value={form.cardholder_name || ''} onChange={(e) => setForm(f => ({ ...f, cardholder_name: e.target.value }))} /></div>
        <div><Label>Monthly limit</Label><Input type="number" value={form.monthly_limit || ''} onChange={(e) => setForm(f => ({ ...f, monthly_limit: e.target.value }))} /></div>
        <div><Label>Alert at %</Label><Input type="number" value={form.alert_threshold_pct || ''} onChange={(e) => setForm(f => ({ ...f, alert_threshold_pct: e.target.value }))} /></div>
        <div><Label>Expiry</Label><Input value={form.expiry || ''} onChange={(e) => setForm(f => ({ ...f, expiry: e.target.value }))} /></div>
        <div><Label>Status</Label><Select value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}><option>active</option><option>inactive</option><option>blocked</option><option>expired</option><option>cancelled</option></Select></div>
      </div>
    </Modal>
  );
}
