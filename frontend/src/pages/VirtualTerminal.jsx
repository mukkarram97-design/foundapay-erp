import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Zap, Banknote, Radio, FileText, ArrowDownToLine, ArrowUp, Send, ArrowUpFromLine } from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, PageHeader, Alert, Badge,
  Table, Thead, Th, Tr, Td, money,
} from '../components/ui';
import TransactionDetail from '../components/ui/TransactionDetail';
import ProcessPayment from '../components/ProcessPayment';
import { toast } from '../store/toast';

const METHOD_FIELDS = {
  'Debit/Credit Cards': 'card_pct',
  'ACH': 'ach_pct',
  'Wire Transfer': 'wire_pct',
  'Cheque': 'cheque_pct',
  'Zelle': 'zelle_pct',
  'PayPal': 'card_pct',
};

const RESERVE_RULES = {
  'DND':      { pct: 0.10, basis: 'gross',          label: '10% of Gross' },
  'Azeem':    { pct: 0.10, basis: 'gross_minus_mc', label: '10% of (Gross − Merchant Charges)' },
  'Husk SOL': { pct: 0.10, basis: 'gross_minus_mc', label: '10% of (Gross − Merchant Charges)' },
};

const TYPES = [
  { id: 'Received',     label: 'Received',     icon: ArrowDownToLine, color: 'var(--success)' },
  { id: 'Paid',         label: 'Paid',         icon: ArrowUpFromLine, color: 'var(--danger)' },
  { id: 'Expense',      label: 'Expense',      icon: Send,            color: 'var(--warning)' },
  { id: 'Advance Paid', label: 'Advance Paid', icon: ArrowUp,         color: 'var(--info)' },
];

const METHODS = [
  { id: 'Debit/Credit Cards', label: 'Cards',  icon: CreditCard },
  { id: 'Zelle',              label: 'Zelle',  icon: Zap },
  { id: 'ACH',                label: 'ACH',    icon: Banknote },
  { id: 'Wire Transfer',      label: 'Wire',   icon: Radio },
  { id: 'Cheque',             label: 'Cheque', icon: FileText },
];

const today = () => new Date().toISOString().slice(0, 10);

export default function VirtualTerminal() {
  const [clients, setClients] = useState([]);
  const [entities, setEntities] = useState([]);
  const [merchants, setMerchants] = useState([]);
  const [todayEntries, setTodayEntries] = useState([]);
  const [openTx, setOpenTx] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const [form, setForm] = useState({
    type: 'Received',
    date_received: today(),
    status: 'Completed',
    client_id: '',
    counterparty_type: 'Client',
    counterparty_name: '',
    payment_method: 'Debit/Credit Cards',
    entity_id: '',
    merchant_account: '',
    gross_amount: '',
    foundapay_fee_pct: '',
    merchant_charges: '',
    bearing_merchant_charges: 'Client',
    notes: '',
    external_txn_id: '',
  });

  async function loadAll() {
    try {
      const [cl, en, me, tx] = await Promise.all([
        api.get('/api/clients'),
        api.get('/api/entities'),
        api.get('/api/merchants'),
        api.get(`/api/transactions?from=${today()}&to=${today()}`),
      ]);
      setClients(cl.rows); setEntities(en.rows); setMerchants(me.rows);
      setTodayEntries(tx.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { loadAll(); }, []);

  const selectedClient = useMemo(() => clients.find((c) => c.id === form.client_id), [clients, form.client_id]);

  // Auto-fill commission %
  useEffect(() => {
    if (!selectedClient || !form.payment_method) return;
    const f = METHOD_FIELDS[form.payment_method];
    if (!f) return;
    // Display fee as percentage (decimal × 100) e.g. 0.30 → "30.00"
    setForm((s) => ({ ...s, foundapay_fee_pct: ((parseFloat(selectedClient[f]) || 0) * 100).toFixed(2), counterparty_name: s.counterparty_name || selectedClient.name }));
    // eslint-disable-next-line
  }, [form.client_id, form.payment_method]);

  const calc = useMemo(() => {
    const gross = parseFloat(form.gross_amount) || 0;
    // Form holds percentage display ("30"); divide by 100 for the multiplier
    const feePctDecimal = (parseFloat(form.foundapay_fee_pct) || 0) / 100;
    const mc = parseFloat(form.merchant_charges) || 0;
    const commission = gross * feePctDecimal;

    let reserve = 0;
    let reserveLabel = null;
    if (selectedClient) {
      const rule = RESERVE_RULES[selectedClient.name];
      if (rule) {
        const base = rule.basis === 'gross' ? gross : Math.max(0, gross - mc);
        reserve = base * rule.pct;
        reserveLabel = rule.label;
      }
    }

    let net = gross - commission - reserve;
    if (form.bearing_merchant_charges === 'Client') net -= mc;

    return { gross, commission, reserve, mc, net, reserveLabel };
  }, [form, selectedClient]);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!form.gross_amount) { setErr('Gross amount is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        gross_amount: parseFloat(form.gross_amount),
        // Form holds percentage; backend stores decimal
        foundapay_fee_pct: (parseFloat(form.foundapay_fee_pct) || 0) / 100,
        merchant_charges: parseFloat(form.merchant_charges) || 0,
        client_id: form.client_id || null,
        entity_id: form.entity_id || null,
      };
      const r = await api.post('/api/transactions', payload);
      toast.success(`Saved #${r.id} — ${money(calc.net)} ${form.type.toLowerCase()}`);
      setForm((f) => ({ ...f, gross_amount: '', merchant_charges: '', notes: '', external_txn_id: '' }));
      loadAll();
    } catch (e) { setErr(e.message); toast.error(e.message); }
    finally { setSaving(false); }
  }

  const todayTotals = useMemo(() => {
    const r = { gross: 0, fees: 0, paid: 0, count: todayEntries.length };
    for (const t of todayEntries) {
      if (t.type === 'Received') { r.gross += parseFloat(t.gross_amount) || 0; r.fees += parseFloat(t.fee_amount) || 0; }
      else if (t.type === 'Paid') r.paid += parseFloat(t.gross_amount) || 0;
    }
    return r;
  }, [todayEntries]);

  const [tab, setTab] = useState('record');

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Virtual Terminal"
        subtitle={tab === 'record'
          ? 'Fast entry — auto commission lookup + live net calculation'
          : 'Charge a card directly via processor APIs'}
      />

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'record', label: 'Record Transaction' },
          { id: 'process', label: 'Process Payment' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px',
              fontSize: 13, fontWeight: 500,
              color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1,
              cursor: 'pointer',
            }}
          >{t.label}</button>
        ))}
      </div>

      {err && <Alert tone="error" className="mb-4">{err}</Alert>}

      {tab === 'process' && <ProcessPayment />}

      {tab === 'record' && <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* LEFT — entry form */}
        <Card className="p-6 lg:col-span-3">
          <form onSubmit={submit} className="space-y-5">

            {/* Step 1: Type */}
            <Step n={1} label="Transaction type">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {TYPES.map((t) => {
                  const Icon = t.icon;
                  const active = form.type === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, type: t.id }))}
                      style={{
                        background: active ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: active ? 'white' : 'var(--text-primary)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 12,
                        padding: '10px 12px',
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        transition: 'all 150ms',
                      }}
                    >
                      <Icon size={16} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Step>

            {/* Step 2: Date + status */}
            <Step n={2} label="Date and status">
              <div className="grid grid-cols-2 gap-3">
                <Input type="date" value={form.date_received} onChange={(e) => setForm((f) => ({ ...f, date_received: e.target.value }))} />
                <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  <option>Completed</option><option>Hold</option><option>Processing</option><option>Charge Back</option>
                </Select>
              </div>
            </Step>

            {/* Step 3: Client + Method */}
            <Step n={3} label="Client + payment method">
              <Select value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}>
                <option value="">— Select client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              {selectedClient && (
                <div className="mt-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  Rates · Card {(selectedClient.card_pct * 100).toFixed(1)}% · Wire {(selectedClient.wire_pct * 100).toFixed(1)}% · ACH {(selectedClient.ach_pct * 100).toFixed(1)}% · Zelle {(selectedClient.zelle_pct * 100).toFixed(1)}%
                  {selectedClient.other_terms && <span style={{ color: 'var(--warning)' }}> · {selectedClient.other_terms}</span>}
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
                {METHODS.map((m) => {
                  const Icon = m.icon;
                  const active = form.payment_method === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, payment_method: m.id }))}
                      style={{
                        background: active ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                        color: active ? 'var(--accent)' : 'var(--text-secondary)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 10,
                        padding: '10px 8px',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Icon size={16} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </Step>

            {/* Step 4: Entity + merchant */}
            <Step n={4} label="Entity + merchant">
              <div className="grid grid-cols-2 gap-3">
                <Select value={form.entity_id} onChange={(e) => setForm((f) => ({ ...f, entity_id: e.target.value }))}>
                  <option value="">— Entity —</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
                </Select>
                <Input
                  placeholder="Merchant account (e.g. Mercury, Authorize.net)"
                  value={form.merchant_account}
                  onChange={(e) => setForm((f) => ({ ...f, merchant_account: e.target.value }))}
                />
              </div>
            </Step>

            {/* Step 5: Amounts */}
            <Step n={5} label="Amounts">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Gross amount</Label>
                  <Input
                    type="number" step="0.01" placeholder="0.00"
                    value={form.gross_amount}
                    onChange={(e) => setForm((f) => ({ ...f, gross_amount: e.target.value }))}
                    style={{ height: 44, fontSize: 20, fontWeight: 600 }}
                    required
                  />
                </div>
                <div>
                  <Label>FoundaPay fee %</Label>
                  <Input
                    type="number" step="0.0001"
                    value={form.foundapay_fee_pct}
                    onChange={(e) => setForm((f) => ({ ...f, foundapay_fee_pct: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Merchant charges</Label>
                  <Input
                    type="number" step="0.01" placeholder="0.00"
                    value={form.merchant_charges}
                    onChange={(e) => setForm((f) => ({ ...f, merchant_charges: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Charges borne by</Label>
                  <div className="flex gap-2">
                    {['Client', 'FoundaPay'].map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, bearing_merchant_charges: b }))}
                        className="fp-btn flex-1"
                        style={{
                          background: form.bearing_merchant_charges === b ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                          color: form.bearing_merchant_charges === b ? 'var(--accent)' : 'var(--text-primary)',
                          border: `1px solid ${form.bearing_merchant_charges === b ? 'var(--accent)' : 'var(--border)'}`,
                        }}
                      >{b}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Input placeholder="External txn ID" value={form.external_txn_id} onChange={(e) => setForm((f) => ({ ...f, external_txn_id: e.target.value }))} />
                <Input placeholder="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </Step>

            <Button type="submit" size="lg" className="w-full" disabled={saving}>
              {saving ? 'Saving…' : `Save ${form.type} — ${money(calc.net)}`}
            </Button>
          </form>
        </Card>

        {/* RIGHT — live calc + today's entries */}
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>Live calculation</h3>
            <Row label="Gross">{money(calc.gross)}</Row>
            <Row label="− Commission" sub={form.foundapay_fee_pct ? `${parseFloat(form.foundapay_fee_pct).toFixed(2)}%` : null} negative>{money(calc.commission)}</Row>
            {calc.mc > 0 && form.bearing_merchant_charges === 'Client' && (
              <Row label="− Merchant charges" negative>{money(calc.mc)}</Row>
            )}
            {calc.reserve > 0 && (
              <Row label="− Reserve hold" sub={calc.reserveLabel} negative tone="warning">{money(calc.reserve)}</Row>
            )}
            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Net to client</div>
              <div className="text-3xl font-semibold mt-1" style={{ color: calc.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {money(calc.net)}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Today's entries</h3>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{todayTotals.count} txns</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <MiniStat label="Received" value={money(todayTotals.gross)} />
              <MiniStat label="Revenue" value={money(todayTotals.fees)} tone="success" />
              <MiniStat label="Paid" value={money(todayTotals.paid)} tone="warning" />
            </div>
            <div className="max-h-72 overflow-y-auto -mx-1 px-1">
              {todayEntries.length === 0 && <div className="text-xs py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>No entries today yet</div>}
              {todayEntries.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setOpenTx(t)}
                  className="w-full flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-left transition"
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <Badge tone={t.type === 'Received' ? 'green' : 'amber'}>{t.type}</Badge>
                  <span className="flex-1 text-xs truncate" style={{ color: 'var(--text-primary)' }}>{t.client_name || t.counterparty_name || '—'}</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{money(t.gross_amount)}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>}

      {openTx && (
        <TransactionDetail
          tx={openTx}
          clients={clients} entities={entities}
          onClose={() => setOpenTx(null)}
          onSaved={() => { setOpenTx(null); loadAll(); }}
          onDeleted={() => { setOpenTx(null); loadAll(); }}
        />
      )}
    </div>
  );
}

function Step({ n, label, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span
          className="flex items-center justify-center text-[11px] font-semibold rounded-full"
          style={{ width: 22, height: 22, background: 'var(--accent-dim)', color: 'var(--accent)' }}
        >{n}</span>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ label, sub, children, negative, tone = 'default' }) {
  const colors = { default: 'var(--text-primary)', success: 'var(--success)', warning: 'var(--warning)' };
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <div>
        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</div>
        {sub && <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{sub}</div>}
      </div>
      <div className="font-mono" style={{ color: negative ? 'var(--text-secondary)' : (colors[tone] || colors.default) }}>{children}</div>
    </div>
  );
}

function MiniStat({ label, value, tone = 'default' }) {
  const colors = { default: 'var(--text-primary)', success: 'var(--success)', warning: 'var(--warning)' };
  return (
    <div className="rounded-lg p-2.5" style={{ background: 'var(--bg-tertiary)' }}>
      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className="text-sm font-semibold font-mono mt-0.5" style={{ color: colors[tone] || colors.default }}>{value}</div>
    </div>
  );
}
