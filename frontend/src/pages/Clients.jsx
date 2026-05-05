import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, pct,
} from '../components/ui';

const VIS_FIELDS = [
  ['show_gross_amount', 'Gross amount'],
  ['show_customer_name', 'Customer name'],
  ['show_customer_email', 'Customer email'],
  ['show_merchant_fee', 'Merchant fee'],
  ['show_commission', 'Commission'],
  ['show_reserve_amount', 'Reserve amount'],
  ['show_chargeback', 'Chargebacks'],
  ['show_settlement_date', 'Settlement date'],
  ['show_processor_name', 'Processor name'],
  ['show_entity_name', 'Entity name'],
  ['show_bank_account', 'Bank account'],
  ['show_payout_status', 'Payout status'],
  ['show_balance', 'Balance'],
  ['show_statement_download', 'Statement download'],
  ['show_proof_files', 'Proof files'],
  ['show_card_assigned', 'Assigned cards'],
];

export default function Clients() {
  const [rows, setRows] = useState([]);
  const [cards, setCards] = useState([]);
  const [editClient, setEditClient] = useState(null);
  const [visClient, setVisClient] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [cl, ca] = await Promise.all([api.get('/api/clients'), api.get('/api/cards')]);
      setRows(cl.rows); setCards(ca.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Clients"
        subtitle={`${rows.length} clients`}
        actions={<Button onClick={() => setCreateOpen(true)}>+ New client</Button>}
      />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th className="text-right">Card</Th><Th className="text-right">Wire</Th>
              <Th className="text-right">ACH</Th><Th className="text-right">Zelle</Th><Th className="text-right">Cheque</Th>
              <Th className="text-right">Opening</Th><Th className="text-right">Balance</Th>
              <Th className="text-right">Revenue</Th>
              <Th>Status</Th><Th></Th>
            </Tr>
          </Thead>
          <tbody>
            {rows.map(c => (
              <Tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td className="text-right font-mono">{pct(c.card_pct)}</Td>
                <Td className="text-right font-mono">{pct(c.wire_pct)}</Td>
                <Td className="text-right font-mono">{pct(c.ach_pct)}</Td>
                <Td className="text-right font-mono">{pct(c.zelle_pct)}</Td>
                <Td className="text-right font-mono">{pct(c.cheque_pct)}</Td>
                <Td className="text-right font-mono">{money(c.opening_balance)}</Td>
                <Td className={`text-right font-mono ${parseFloat(c.balance_owed) < 0 ? 'text-red-400' : ''}`}>{money(c.balance_owed)}</Td>
                <Td className="text-right font-mono text-emerald-400">{money(c.total_revenue)}</Td>
                <Td><Badge tone={c.status === 'active' ? 'green' : 'zinc'}>{c.status}</Badge></Td>
                <Td>
                  <div className="flex gap-2 text-xs">
                    <button className="text-[var(--accent)] hover:opacity-80" onClick={() => setEditClient(c)}>Edit</button>
                    <button className="text-[var(--accent)] hover:opacity-80" onClick={() => setVisClient(c)}>Visibility</button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {createOpen && <ClientForm onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); load(); }} />}
      {editClient && <ClientForm client={editClient} onClose={() => setEditClient(null)} onSaved={() => { setEditClient(null); load(); }} />}
      {visClient && <VisibilityModal client={visClient} cards={cards} onClose={() => setVisClient(null)} onSaved={() => { setVisClient(null); load(); }} />}
    </div>
  );
}

function ClientForm({ client, onClose, onSaved }) {
  const [form, setForm] = useState(client || { name: '', card_pct: 0, wire_pct: 0, ach_pct: 0, zelle_pct: 0, cheque_pct: 0, opening_balance: 0, status: 'active' });
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const payload = {
        name: form.name,
        card_pct: parseFloat(form.card_pct) || 0,
        wire_pct: parseFloat(form.wire_pct) || 0,
        ach_pct: parseFloat(form.ach_pct) || 0,
        zelle_pct: parseFloat(form.zelle_pct) || 0,
        cheque_pct: parseFloat(form.cheque_pct) || 0,
        opening_balance: parseFloat(form.opening_balance) || 0,
        balance_owed: parseFloat(form.balance_owed) || 0,
        status: form.status, other_terms: form.other_terms, email: form.email, phone: form.phone, country: form.country,
      };
      if (client) await api.patch(`/api/clients/${client.id}`, payload);
      else await api.post('/api/clients', payload);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={client ? `Edit ${client.name}` : 'New client'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Name</Label><Input value={form.name || ''} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
        <div><Label>Status</Label><Select value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}><option>active</option><option>inactive</option><option>on_hold</option><option>risk</option></Select></div>
        <div><Label>Card %</Label><Input type="number" step="0.001" value={form.card_pct ?? ''} onChange={(e) => setForm(f => ({ ...f, card_pct: e.target.value }))} /></div>
        <div><Label>Wire %</Label><Input type="number" step="0.001" value={form.wire_pct ?? ''} onChange={(e) => setForm(f => ({ ...f, wire_pct: e.target.value }))} /></div>
        <div><Label>ACH %</Label><Input type="number" step="0.001" value={form.ach_pct ?? ''} onChange={(e) => setForm(f => ({ ...f, ach_pct: e.target.value }))} /></div>
        <div><Label>Zelle %</Label><Input type="number" step="0.001" value={form.zelle_pct ?? ''} onChange={(e) => setForm(f => ({ ...f, zelle_pct: e.target.value }))} /></div>
        <div><Label>Cheque %</Label><Input type="number" step="0.001" value={form.cheque_pct ?? ''} onChange={(e) => setForm(f => ({ ...f, cheque_pct: e.target.value }))} /></div>
        <div><Label>Opening balance</Label><Input type="number" step="0.01" value={form.opening_balance ?? ''} onChange={(e) => setForm(f => ({ ...f, opening_balance: e.target.value }))} /></div>
        <div className="col-span-2"><Label>Other terms</Label><Input value={form.other_terms || ''} onChange={(e) => setForm(f => ({ ...f, other_terms: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}

function VisibilityModal({ client, cards, onClose, onSaved }) {
  const [vis, setVis] = useState(null);
  const [assigned, setAssigned] = useState([]);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pickCardId, setPickCardId] = useState('');

  async function load() {
    try {
      const r = await api.get(`/api/clients/${client.id}`);
      setVis(r.visibility || {});
      setAssigned(r.cards || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function save() {
    setSaving(true); setErr(null);
    try {
      await api.patch(`/api/clients/${client.id}/visibility`, vis);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function assignCard() {
    if (!pickCardId) return;
    await api.post(`/api/clients/${client.id}/assign-card`, { card_id: pickCardId });
    setPickCardId('');
    load();
  }

  async function removeCard(cardId) {
    await api.delete(`/api/clients/${client.id}/cards/${cardId}`);
    load();
  }

  return (
    <Modal open onClose={onClose} title={`${client.name} — visibility & cards`} wide
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save visibility'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      {!vis && <div className="text-[var(--text-tertiary)]">Loading…</div>}
      {vis && (
        <>
          <div className="mb-5">
            <h4 className="text-sm font-medium text-[var(--text-primary)] mb-2">Field visibility (client portal view)</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {VIS_FIELDS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                  <input type="checkbox" checked={!!vis[k]} onChange={(e) => setVis(v => ({ ...v, [k]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-4">
            <h4 className="text-sm font-medium text-[var(--text-primary)] mb-2">Assigned cards</h4>
            <div className="flex gap-2 mb-3">
              <Select value={pickCardId} onChange={(e) => setPickCardId(e.target.value)}>
                <option value="">— Pick a card —</option>
                {cards.filter(c => !assigned.some(a => a.id === c.id)).map(c =>
                  <option key={c.id} value={c.id}>{c.nickname} ••{c.last4} ({c.bank_name})</option>
                )}
              </Select>
              <Button onClick={assignCard} disabled={!pickCardId}>Assign</Button>
            </div>
            <div className="space-y-1">
              {assigned.map(c => (
                <div key={c.id} className="flex items-center justify-between text-sm bg-[var(--bg-primary)] border border-[var(--border)] rounded px-3 py-2">
                  <span>{c.nickname} <span className="text-[var(--text-tertiary)] font-mono">••{c.last4}</span> · {c.bank_name}</span>
                  <button className="text-red-400 text-xs" onClick={() => removeCard(c.id)}>Remove</button>
                </div>
              ))}
              {assigned.length === 0 && <div className="text-[var(--text-tertiary)] text-sm">No cards assigned</div>}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
