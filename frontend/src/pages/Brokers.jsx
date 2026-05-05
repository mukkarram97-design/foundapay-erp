import React, { useEffect, useState } from 'react';
import { Plus, DollarSign, Briefcase } from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, PageHeader, Alert, Badge, Modal,
  Table, Thead, Th, Tr, Td, money, pct,
} from '../components/ui';
import { toast } from '../store/toast';

export default function Brokers() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [pay, setPay] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [b, c] = await Promise.all([api.get('/api/brokers'), api.get('/api/clients')]);
      setRows(b.rows); setClients(c.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const totals = rows.reduce(
    (a, r) => ({
      earnings: a.earnings + parseFloat(r.april_earnings || 0),
      paid: a.paid + parseFloat(r.total_paid || 0),
      owed: a.owed + parseFloat(r.balance_owed || 0),
    }),
    { earnings: 0, paid: 0, owed: 0 }
  );

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Brokers"
        subtitle={`${rows.length} brokers · April commissions`}
        actions={<Button onClick={() => setCreateOpen(true)}><Plus size={14} /> New broker</Button>}
      />
      {err && <Alert tone="error" className="mb-4">{err}</Alert>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Stat label="April earnings" value={money(totals.earnings)} icon={DollarSign} tone="success" />
        <Stat label="Total paid" value={money(totals.paid)} icon={Briefcase} />
        <Stat label="Balance owed" value={money(totals.owed)} tone="warning" />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead><Tr>
            <Th>Broker</Th><Th>Manages</Th><Th>Basis</Th><Th className="text-right">Rate</Th>
            <Th className="text-right">April basis</Th><Th className="text-right">April earnings</Th>
            <Th className="text-right">Paid</Th><Th className="text-right">Balance</Th>
            <Th>Status</Th><Th></Th>
          </Tr></Thead>
          <tbody>
            {rows.map((b) => (
              <Tr key={b.id}>
                <Td className="font-medium">{b.name}</Td>
                <Td>{b.client_name || '—'}</Td>
                <Td><Badge tone="neutral">{b.basis}</Badge></Td>
                <Td className="text-right font-mono">{pct(b.commission_pct)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{money(b.april_basis)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--success)' }}>{money(b.april_earnings)}</Td>
                <Td className="text-right font-mono">{money(b.total_paid)}</Td>
                <Td className="text-right font-mono" style={{ color: parseFloat(b.balance_owed) > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                  {money(b.balance_owed)}
                </Td>
                <Td><Badge tone={b.status === 'active' ? 'success' : 'neutral'}>{b.status}</Badge></Td>
                <Td>
                  <div className="flex gap-2 text-xs">
                    <button className="text-xs" style={{ color: 'var(--accent)' }} onClick={() => setPay(b)}>Pay</button>
                    <button className="text-xs" style={{ color: 'var(--accent)' }} onClick={() => setEdit(b)}>Edit</button>
                  </div>
                </Td>
              </Tr>
            ))}
            {rows.length === 0 && <Tr><Td colSpan="10" style={{ color: 'var(--text-secondary)' }}>No brokers yet.</Td></Tr>}
          </tbody>
        </Table>
      </Card>

      {(createOpen || edit) && (
        <BrokerForm
          broker={edit} clients={clients}
          onClose={() => { setEdit(null); setCreateOpen(false); }}
          onSaved={() => { setEdit(null); setCreateOpen(false); load(); }}
        />
      )}
      {pay && <PayModal broker={pay} onClose={() => setPay(null)} onSaved={() => { setPay(null); load(); }} />}
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone = 'default' }) {
  const colors = { default: 'var(--text-primary)', success: 'var(--success)', warning: 'var(--warning)' };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1.5">
        {Icon && <Icon size={12} style={{ color: colors[tone] }} />}
        <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      </div>
      <div className="text-xl font-semibold" style={{ color: colors[tone] }}>{value}</div>
    </Card>
  );
}

function BrokerForm({ broker, clients, onClose, onSaved }) {
  const [form, setForm] = useState(broker || { commission_pct: 0.01, basis: 'gross_received', status: 'active' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = { ...form,
        commission_pct: parseFloat(form.commission_pct),
        managed_client_id: form.managed_client_id || null,
      };
      if (broker) await api.patch(`/api/brokers/${broker.id}`, body);
      else        await api.post('/api/brokers', body);
      toast.success('Saved');
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={broker ? `Edit ${broker.name}` : 'New broker'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Name</Label><Input value={form.name || ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
        <div><Label>Email</Label><Input type="email" value={form.email || ''} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
        <div><Label>Phone</Label><Input value={form.phone || ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
        <div className="col-span-2"><Label>Manages client</Label><Select value={form.managed_client_id || ''} onChange={(e) => setForm((f) => ({ ...f, managed_client_id: e.target.value }))}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><Label>Commission %</Label><Input type="number" step="0.0001" value={form.commission_pct ?? ''} onChange={(e) => setForm((f) => ({ ...f, commission_pct: e.target.value }))} /></div>
        <div><Label>Basis</Label><Select value={form.basis} onChange={(e) => setForm((f) => ({ ...f, basis: e.target.value }))}>
          <option value="gross_received">Gross received</option>
          <option value="revenue">Revenue (commission)</option>
          <option value="net_to_client">Net to client</option>
          <option value="custom">Custom</option>
        </Select></div>
        <div><Label>Status</Label><Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}><option>active</option><option>paused</option><option>inactive</option></Select></div>
        <div className="col-span-2"><Label>Notes</Label><Input value={form.notes || ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}

function PayModal({ broker, onClose, onSaved }) {
  const [amount, setAmount] = useState(broker.balance_owed > 0 ? broker.balance_owed : '');
  const [period, setPeriod] = useState('April 2026');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  async function pay() {
    setBusy(true);
    try {
      await api.post(`/api/brokers/${broker.id}/pay`, { amount: parseFloat(amount), period, reference });
      toast.success(`Paid ${money(amount)} to ${broker.name}`);
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Pay ${broker.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={pay} disabled={busy || !amount}>{busy ? 'Recording…' : `Pay ${money(amount || 0)}`}</Button></>}
    >
      <div className="space-y-3">
        <div><Label>Amount (USD)</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label>Period</Label><Input value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
        <div><Label>Reference</Label><Input placeholder="Transfer ID, check #..." value={reference} onChange={(e) => setReference(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
