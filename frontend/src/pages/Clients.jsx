import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, pct,
} from '../components/ui';
import { toast } from '../store/toast';

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
  const [rateHistoryClient, setRateHistoryClient] = useState(null);
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
              <Th>Logo</Th>
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
                <Td>
                  {c.logo_url
                    ? <img src={c.logo_url} alt={c.name} style={{ height: 28, maxWidth: 80, objectFit: 'contain' }} />
                    : <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>—</span>}
                </Td>
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
                    <button className="text-[var(--accent)] hover:opacity-80" onClick={() => setRateHistoryClient(c)}>Rates</button>
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
      {rateHistoryClient && <RateHistoryModal client={rateHistoryClient} onClose={() => setRateHistoryClient(null)} onSaved={load} />}
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
      {client?.id && (
        <div className="mb-4">
          <BrandingSection client={client} onChanged={(newUrl) => { client.logo_url = newUrl; setForm(f => ({ ...f })); }} />
        </div>
      )}
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


// ━━━ Branding (logo upload) section ━━━
function BrandingSection({ client, onChanged }) {
  const [logoUrl, setLogoUrl] = React.useState(client.logo_url);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef(null);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const token = localStorage.getItem("foundapay_token");
      const res = await fetch(`/api/clients/${client.id}/logo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setLogoUrl(data.logo_url);
      onChanged?.(data.logo_url);
      toast.success("Logo uploaded");
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm("Remove logo?")) return;
    setBusy(true);
    try {
      await api.delete(`/api/clients/${client.id}/logo`);
      setLogoUrl(null);
      onChanged?.(null);
      toast.success("Logo removed");
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-4" style={{ background: "var(--bg-tertiary)" }}>
      <Label>Branding (appears on payment pages + receipts)</Label>
      <div className="flex items-center gap-3 mt-2">
        <div style={{
          width: 120, height: 60, border: "1px dashed var(--border)",
          borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--bg-primary)", overflow: "hidden",
        }}>
          {logoUrl
            ? <img src={logoUrl} alt="logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            : <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>No logo</span>}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            style={{ display: "none" }}
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {logoUrl && (
            <Button variant="ghost" disabled={busy} onClick={remove}>
              Remove
            </Button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 8 }}>
        PNG, JPG, WebP, or SVG. Max 1 MB. Recommended ~400×100px.
      </div>
    </Card>
  );
}

// ━━━ Rate history modal ━━━
function RateHistoryModal({ client, onClose, onSaved }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [changing, setChanging] = React.useState(false);
  const { user } = (() => {
    try { const u = JSON.parse(localStorage.getItem('foundapay_user') || 'null'); return { user: u }; }
    catch { return { user: null }; }
  })();
  const isSuperAdmin = user?.role === 'super_admin';

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/api/clients/${client.id}/rate-history`);
      setRows(r.rows);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [client.id]);

  return (
    <Modal open onClose={onClose} title={`Rate history — ${client.name}`} wide
      footer={<Button onClick={onClose}>Close</Button>}>
      <div className="mb-4">
        <Card className="p-3" style={{ background: 'var(--bg-tertiary)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Current rates (live)</div>
          <div className="grid grid-cols-5 gap-2 mt-2 text-sm">
            <div>Card: <strong>{((client.card_pct || 0) * 100).toFixed(2)}%</strong></div>
            <div>Wire: <strong>{((client.wire_pct || 0) * 100).toFixed(2)}%</strong></div>
            <div>ACH: <strong>{((client.ach_pct || 0) * 100).toFixed(2)}%</strong></div>
            <div>Zelle: <strong>{((client.zelle_pct || 0) * 100).toFixed(2)}%</strong></div>
            <div>Cheque: <strong>{((client.cheque_pct || 0) * 100).toFixed(2)}%</strong></div>
          </div>
        </Card>
      </div>

      {isSuperAdmin && !changing && (
        <div className="mb-4">
          <Button onClick={() => setChanging(true)}>+ Change rates</Button>
        </div>
      )}

      {changing && (
        <ChangeRatesForm client={client} onCancel={() => setChanging(false)}
          onSaved={() => { setChanging(false); load(); onSaved?.(); }} />
      )}

      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>
        Timeline ({rows.length} {rows.length === 1 ? 'change' : 'changes'})
      </div>

      {loading && <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>}
      {!loading && rows.length === 0 && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          No rate-history records yet. Existing transactions used the rates baked in at write-time.
        </div>
      )}
      {rows.map((r) => (
        <Card key={r.id} className="p-3 mb-2">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                Effective {r.effective_from}
                {r.effective_to ? ` → ${r.effective_to}` : ' → ongoing'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                Changed by {r.changed_by_name || 'unknown'} at {new Date(r.created_at).toLocaleString()}
              </div>
            </div>
            <Badge tone={r.effective_to ? 'neutral' : 'success'}>
              {r.effective_to ? 'historical' : 'current'}
            </Badge>
          </div>
          <div className="grid grid-cols-5 gap-2 text-sm" style={{ marginTop: 6 }}>
            <div>Card: <strong>{r.card_pct != null ? (r.card_pct * 100).toFixed(2) + '%' : '—'}</strong></div>
            <div>Wire: <strong>{r.wire_pct != null ? (r.wire_pct * 100).toFixed(2) + '%' : '—'}</strong></div>
            <div>ACH: <strong>{r.ach_pct != null ? (r.ach_pct * 100).toFixed(2) + '%' : '—'}</strong></div>
            <div>Zelle: <strong>{r.zelle_pct != null ? (r.zelle_pct * 100).toFixed(2) + '%' : '—'}</strong></div>
            <div>Cheque: <strong>{r.cheque_pct != null ? (r.cheque_pct * 100).toFixed(2) + '%' : '—'}</strong></div>
          </div>
          {r.change_reason && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, padding: 8, background: 'var(--bg-tertiary)', borderRadius: 6 }}>
              <em>"{r.change_reason}"</em>
            </div>
          )}
        </Card>
      ))}
    </Modal>
  );
}

function ChangeRatesForm({ client, onCancel, onSaved }) {
  const [form, setForm] = React.useState({
    effective_from: new Date().toISOString().slice(0, 10),
    change_reason: '',
    card_pct: ((client.card_pct || 0) * 100).toFixed(2),
    wire_pct: ((client.wire_pct || 0) * 100).toFixed(2),
    ach_pct: ((client.ach_pct || 0) * 100).toFixed(2),
    zelle_pct: ((client.zelle_pct || 0) * 100).toFixed(2),
    cheque_pct: ((client.cheque_pct || 0) * 100).toFixed(2),
  });
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!form.change_reason.trim()) return toast.error('Reason is required');
    setBusy(true);
    try {
      await api.post(`/api/clients/${client.id}/rate-history`, {
        effective_from: form.effective_from,
        change_reason: form.change_reason,
        card_pct: parseFloat(form.card_pct) / 100,
        wire_pct: parseFloat(form.wire_pct) / 100,
        ach_pct: parseFloat(form.ach_pct) / 100,
        zelle_pct: parseFloat(form.zelle_pct) / 100,
        cheque_pct: parseFloat(form.cheque_pct) / 100,
      });
      toast.success('Rate change saved');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-4 mb-4" style={{ borderLeft: '3px solid var(--accent)' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>New rate change</div>
      <Alert tone="warning" className="my-3">
        Existing transactions keep their recorded rate. Only new transactions from <strong>{form.effective_from}</strong> onwards will use these rates.
      </Alert>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <Label>Effective from</Label>
          <Input type="date" value={form.effective_from}
            onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} />
        </div>
        <div>
          <Label>Reason (required)</Label>
          <Input value={form.change_reason}
            onChange={(e) => setForm((f) => ({ ...f, change_reason: e.target.value }))}
            placeholder="e.g. Promotional rate ended, contract renegotiation" />
        </div>
        <div><Label>Card %</Label><Input type="number" step="0.01" value={form.card_pct} onChange={(e) => setForm((f) => ({ ...f, card_pct: e.target.value }))} /></div>
        <div><Label>Wire %</Label><Input type="number" step="0.01" value={form.wire_pct} onChange={(e) => setForm((f) => ({ ...f, wire_pct: e.target.value }))} /></div>
        <div><Label>ACH %</Label><Input type="number" step="0.01" value={form.ach_pct} onChange={(e) => setForm((f) => ({ ...f, ach_pct: e.target.value }))} /></div>
        <div><Label>Zelle %</Label><Input type="number" step="0.01" value={form.zelle_pct} onChange={(e) => setForm((f) => ({ ...f, zelle_pct: e.target.value }))} /></div>
        <div><Label>Cheque %</Label><Input type="number" step="0.01" value={form.cheque_pct} onChange={(e) => setForm((f) => ({ ...f, cheque_pct: e.target.value }))} /></div>
      </div>
      <div className="flex gap-2 mt-4">
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save new rate'}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}
