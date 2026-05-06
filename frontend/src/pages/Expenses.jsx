import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge, Table, Thead, Th, Tr, Td, money, dateOnly } from '../components/ui';

export default function Expenses() {
  const [tab, setTab] = useState('all');
  const [rows, setRows] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const [cards, setCards] = useState([]);
  const [entities, setEntities] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [ex, ren, c, e] = await Promise.all([
        api.get('/api/expenses'),
        api.get('/api/expenses/renewals?days=30'),
        api.get('/api/cards'),
        api.get('/api/entities'),
      ]);
      setRows(ex.rows); setRenewals(ren.rows); setCards(c.rows); setEntities(e.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function submitForApproval(r) {
    const reason = prompt(`Submit expense for super-admin approval?\n\n${r.vendor || r.description || ''} — ${money(r.amount)}\n\nEnter notes (optional):`);
    if (reason === null) return;
    try {
      await api.post('/api/approvals', {
        type: 'expense_approval',
        reference_type: 'expense',
        reference_id: r.id,
        amount: parseFloat(r.amount),
        currency: 'USD',
        request_reason: reason || `Approval requested for expense: ${r.vendor || r.description || r.id}`,
      });
      alert('Expense submitted for super-admin approval.');
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  }

  const grouped = {};
  for (const r of rows) {
    const k = r.card_id || 'no_card';
    grouped[k] = grouped[k] || { card: r.card_nickname ? `${r.card_nickname} ••${r.card_last4}` : 'No card', items: [], total: 0 };
    grouped[k].items.push(r);
    grouped[k].total += parseFloat(r.amount) || 0;
  }

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Expenses"
        actions={<Button onClick={() => setCreateOpen(true)}>+ New expense</Button>}
      />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      {renewals.length > 0 && (
        <Alert tone="warning" className="mb-4">
          <strong>{renewals.length} renewal{renewals.length > 1 ? 's' : ''} in the next 30 days</strong>
          <ul className="mt-1 text-xs">
            {renewals.slice(0, 5).map(r => <li key={r.id}>{r.vendor || r.description} — {dateOnly(r.next_renewal_date)} ({money(r.amount)})</li>)}
          </ul>
        </Alert>
      )}

      <div className="flex gap-2 mb-4">
        <Button variant={tab === 'all' ? 'primary' : 'secondary'} onClick={() => setTab('all')}>All expenses</Button>
        <Button variant={tab === 'by_card' ? 'primary' : 'secondary'} onClick={() => setTab('by_card')}>By card</Button>
      </div>

      {tab === 'all' && (
        <Card className="overflow-hidden">
          <Table>
            <Thead><Tr><Th>Date</Th><Th>Vendor</Th><Th>Description</Th><Th>Card</Th><Th>Category</Th><Th className="text-right">Amount</Th><Th></Th></Tr></Thead>
            <tbody>
              {rows.map(r => (
                <Tr key={r.id}>
                  <Td>{dateOnly(r.date)}</Td>
                  <Td>{r.vendor || '—'}</Td>
                  <Td className="text-[var(--text-secondary)]">{r.description || '—'}</Td>
                  <Td className="text-[var(--text-tertiary)] text-xs">{r.card_nickname ? `${r.card_nickname} ••${r.card_last4}` : '—'}</Td>
                  <Td><Badge>{r.category || 'Uncategorized'}</Badge></Td>
                  <Td className="text-right font-mono">{money(r.amount)}</Td>
                  <Td>
                    <div className="flex gap-2 text-xs flex-wrap">
                      {r.status !== 'approved' && (
                        <button className="text-violet-400" onClick={() => submitForApproval(r)} title="Send to super admin for approval">
                          Submit for Approval
                        </button>
                      )}
                      <button className="text-[var(--accent)]" onClick={() => setEdit(r)}>Edit</button>
                    </div>
                  </Td>
                </Tr>
              ))}
              {rows.length === 0 && <Tr><Td colSpan="7"><span className="text-[var(--text-tertiary)]">No expenses yet</span></Td></Tr>}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === 'by_card' && (
        <div className="space-y-3">
          {Object.entries(grouped).map(([k, g]) => (
            <Card key={k} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-[var(--text-primary)]">{g.card}</h3>
                <span className="text-sm font-mono text-[var(--text-secondary)]">{money(g.total)}</span>
              </div>
              <Table>
                <Thead><Tr><Th>Date</Th><Th>Vendor</Th><Th>Category</Th><Th className="text-right">Amount</Th></Tr></Thead>
                <tbody>
                  {g.items.map(r => (
                    <Tr key={r.id}>
                      <Td>{dateOnly(r.date)}</Td>
                      <Td>{r.vendor || '—'}</Td>
                      <Td className="text-[var(--text-tertiary)] text-xs">{r.category || 'Uncategorized'}</Td>
                      <Td className="text-right font-mono">{money(r.amount)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
          {Object.keys(grouped).length === 0 && <Card className="p-6 text-[var(--text-tertiary)]">No expenses yet</Card>}
        </div>
      )}

      {(createOpen || edit) && (
        <ExpenseForm
          expense={edit}
          cards={cards}
          entities={entities}
          onClose={() => { setEdit(null); setCreateOpen(false); }}
          onSaved={() => { setEdit(null); setCreateOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function ExpenseForm({ expense, cards, entities, onClose, onSaved }) {
  const [form, setForm] = useState(expense ? { ...expense, date: dateOnly(expense.date) } : { date: new Date().toISOString().slice(0, 10), currency: 'USD', is_recurring: false });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = {
        ...form,
        amount: parseFloat(form.amount) || 0,
        card_id: form.card_id || null,
        entity_id: form.entity_id || null,
      };
      if (expense) await api.patch(`/api/expenses/${expense.id}`, body);
      else         await api.post('/api/expenses', body);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={expense ? 'Edit expense' : 'New expense'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))} /></div>
        <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount || ''} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
        <div><Label>Vendor</Label><Input value={form.vendor || ''} onChange={(e) => setForm(f => ({ ...f, vendor: e.target.value }))} /></div>
        <div><Label>Category</Label><Input value={form.category || ''} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} /></div>
        <div><Label>Card</Label><Select value={form.card_id || ''} onChange={(e) => setForm(f => ({ ...f, card_id: e.target.value }))}><option value="">—</option>{cards.map(c => <option key={c.id} value={c.id}>{c.nickname} ••{c.last4}</option>)}</Select></div>
        <div><Label>Entity</Label><Select value={form.entity_id || ''} onChange={(e) => setForm(f => ({ ...f, entity_id: e.target.value }))}><option value="">—</option>{entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</Select></div>
        <div className="col-span-2"><Label>Description</Label><Input value={form.description || ''} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        <div className="col-span-2 flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={!!form.is_recurring} onChange={(e) => setForm(f => ({ ...f, is_recurring: e.target.checked }))} />
            Recurring
          </label>
          {form.is_recurring && (
            <>
              <Input value={form.recurrence_interval || ''} placeholder="monthly/annually..." onChange={(e) => setForm(f => ({ ...f, recurrence_interval: e.target.value }))} className="w-40" />
              <Input type="date" value={form.next_renewal_date || ''} onChange={(e) => setForm(f => ({ ...f, next_renewal_date: e.target.value }))} className="w-44" />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
