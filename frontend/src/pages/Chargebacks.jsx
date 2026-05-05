import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Upload, CheckCircle2, Trophy, Plus } from 'lucide-react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge, money, dateOnly } from '../components/ui';
import { toast } from '../store/toast';

function urgency(days) {
  if (days == null) return { tone: 'neutral', label: 'No deadline', border: 'var(--border)' };
  if (days < 0) return { tone: 'danger', label: `Overdue ${-days}d`, border: 'var(--danger)' };
  if (days <= 3) return { tone: 'danger', label: `${days}d left`, border: 'var(--danger)' };
  if (days <= 7) return { tone: 'warning', label: `${days}d left`, border: 'var(--warning)' };
  return { tone: 'success', label: `${days}d left`, border: 'var(--success)' };
}

export default function Chargebacks() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [merchants, setMerchants] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [cb, c, m] = await Promise.all([api.get('/api/chargebacks'), api.get('/api/clients'), api.get('/api/merchants')]);
      setRows(cb.rows); setClients(c.rows); setMerchants(m.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const summary = useMemo(() => {
    const s = { open: 0, evidence_submitted: 0, won: 0, lost: 0, total_at_risk: 0 };
    for (const r of rows) {
      s[r.status] = (s[r.status] || 0) + 1;
      if (r.status === 'open' || r.status === 'evidence_submitted') s.total_at_risk += parseFloat(r.amount) || 0;
    }
    return s;
  }, [rows]);

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Chargebacks"
        subtitle={`${rows.length} total · ${summary.open} open`}
        actions={<Button onClick={() => setCreateOpen(true)}><Plus size={14} /> New chargeback</Button>}
      />
      {err && <Alert tone="error" className="mb-4">{err}</Alert>}

      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Open" value={summary.open} tone="warning" />
        <Stat label="Evidence submitted" value={summary.evidence_submitted} tone="info" />
        <Stat label="Won" value={summary.won} tone="success" icon={Trophy} />
        <Stat label="Lost" value={summary.lost} tone="danger" />
        <Stat label="Total at risk" value={money(summary.total_at_risk)} tone="danger" />
      </div>

      {/* Cards */}
      {rows.length === 0 && (
        <Card className="p-12 text-center">
          <CheckCircle2 size={32} className="mx-auto mb-2" style={{ color: 'var(--success)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No chargebacks. Keep it that way!</p>
        </Card>
      )}

      <div className="space-y-3">
        {rows.map((r) => {
          const days = r.days_to_deadline == null ? null : Math.round(parseFloat(r.days_to_deadline));
          const u = urgency(days);
          return (
            <Card key={r.id} className="p-5 relative" style={{ borderLeft: `4px solid ${u.border}` }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>
                      {r.client_name || r.customer_name || '—'}
                    </h3>
                    <Badge tone={r.status === 'won' ? 'success' : r.status === 'lost' ? 'danger' : 'warning'}>{r.status}</Badge>
                    {r.result && <Badge tone={r.result === 'won' ? 'success' : 'danger'}>Result: {r.result}</Badge>}
                  </div>
                  <div className="text-2xl font-semibold" style={{ color: 'var(--danger)' }}>{money(r.amount)}</div>
                  {r.reason && <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.reason}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
                    {r.processor_name && (
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Processor: <strong style={{ color: 'var(--text-primary)' }}>{r.processor_name}</strong>
                      </span>
                    )}
                    {r.cb_fee && parseFloat(r.cb_fee) > 0 && (
                      <span style={{ color: 'var(--text-secondary)' }}>
                        CB fee: <strong style={{ color: 'var(--text-primary)' }}>{money(r.cb_fee)}</strong>
                      </span>
                    )}
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Evidence: <strong style={{ color: r.evidence_uploaded ? 'var(--success)' : 'var(--warning)' }}>{r.evidence_uploaded ? 'Uploaded' : 'Not uploaded'}</strong>
                    </span>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1 justify-end mb-2">
                    <AlertTriangle size={14} style={{ color: u.border }} />
                    <Badge tone={u.tone}>{u.label}</Badge>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    Deadline: {dateOnly(r.evidence_deadline)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-light)' }}>
                <Button
                  variant="secondary" size="sm"
                  onClick={async () => {
                    await api.patch(`/api/chargebacks/${r.id}`, { evidence_uploaded: !r.evidence_uploaded });
                    toast.success(r.evidence_uploaded ? 'Marked: not uploaded' : 'Marked: uploaded');
                    load();
                  }}
                >
                  <Upload size={12} /> {r.evidence_uploaded ? 'Mark not uploaded' : 'Mark evidence uploaded'}
                </Button>
                {r.status !== 'won' && r.status !== 'lost' && (
                  <>
                    <Button
                      variant="success" size="sm"
                      onClick={async () => {
                        await api.patch(`/api/chargebacks/${r.id}`, { status: 'won', result: 'won' });
                        toast.success('Marked won');
                        load();
                      }}
                    >
                      <Trophy size={12} /> Mark won
                    </Button>
                    <Button
                      variant="danger" size="sm"
                      onClick={async () => {
                        await api.patch(`/api/chargebacks/${r.id}`, { status: 'lost', result: 'lost' });
                        load();
                      }}
                    >Mark lost</Button>
                  </>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEdit(r)} className="ml-auto">View / edit</Button>
              </div>
            </Card>
          );
        })}
      </div>

      {(createOpen || edit) && (
        <CBForm
          cb={edit} clients={clients} merchants={merchants}
          onClose={() => { setEdit(null); setCreateOpen(false); }}
          onSaved={() => { setEdit(null); setCreateOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'default', icon: Icon }) {
  const colors = {
    default: 'var(--text-primary)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger:  'var(--danger)',
    info:    'var(--info)',
  };
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

function CBForm({ cb, clients, merchants, onClose, onSaved }) {
  const [form, setForm] = useState(cb || { status: 'open', cb_fee: 45 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = { ...form, amount: parseFloat(form.amount) || 0, cb_fee: parseFloat(form.cb_fee) || 0 };
      if (cb) await api.patch(`/api/chargebacks/${cb.id}`, body);
      else    await api.post('/api/chargebacks', body);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={cb ? 'Edit chargeback' : 'New chargeback'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Customer name</Label><Input value={form.customer_name || ''} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} /></div>
        <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount || ''} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
        <div><Label>Client</Label><Select value={form.client_id || ''} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><Label>Merchant</Label><Select value={form.merchant_id || ''} onChange={(e) => setForm((f) => ({ ...f, merchant_id: e.target.value }))}><option value="">—</option>{merchants.map((m) => <option key={m.id} value={m.id}>{m.processor_name} — {m.entity_name}</option>)}</Select></div>
        <div><Label>CB fee</Label><Input type="number" step="0.01" value={form.cb_fee || ''} onChange={(e) => setForm((f) => ({ ...f, cb_fee: e.target.value }))} /></div>
        <div><Label>Evidence deadline</Label><Input type="date" value={dateOnly(form.evidence_deadline) === '—' ? '' : dateOnly(form.evidence_deadline)} onChange={(e) => setForm((f) => ({ ...f, evidence_deadline: e.target.value }))} /></div>
        <div><Label>Status</Label><Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}><option>open</option><option>evidence_submitted</option><option>won</option><option>lost</option><option>escalated</option><option>closed</option></Select></div>
        <div><Label>Result</Label><Select value={form.result || ''} onChange={(e) => setForm((f) => ({ ...f, result: e.target.value || null }))}><option value="">—</option><option>won</option><option>lost</option></Select></div>
        <div className="col-span-2"><Label>Reason</Label><Input value={form.reason || ''} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}
