import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { api } from '../utils/api';
import { Button, Input, Select, Label, Textarea, money, dateOnly } from './ui';
import { toast } from '../store/toast';

// ━━━ Reserve rules ─────────────────────────────────────────
const RESERVE_RULES = {
  'DND':      { pct: 0.10, basis: 'gross',          label: '10% of Gross' },
  'Azeem':    { pct: 0.10, basis: 'gross_minus_mc', label: '10% of (Gross − Merchant Charges)' },
  'Husk SOL': { pct: 0.10, basis: 'gross_minus_mc', label: '10% of (Gross − Merchant Charges)' },
};

const METHOD_FIELDS = {
  'Debit/Credit Cards': 'card_pct',
  'ACH': 'ach_pct',
  'Wire Transfer': 'wire_pct',
  'Cheque': 'cheque_pct',
  'Zelle': 'zelle_pct',
  'PayPal': 'card_pct',
};

const TYPES = ['Received', 'Paid', 'Expense', 'Advance Paid'];
const STATUSES = ['Completed', 'Hold', 'Processing', 'Charge Back'];

const today = () => new Date().toISOString().slice(0, 10);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NewTransactionModal — slide-over from right, focused create-only form
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function NewTransactionModal({ onClose, onSaved, defaultClientId = null }) {
  const overlayRef = useRef(null);

  const [clients, setClients] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  const [form, setForm] = useState({
    type: 'Received',
    date_received: today(),
    status: 'Completed',
    client_id: defaultClientId || '',
    counterparty_type: 'Client',
    counterparty_name: '',
    payment_method: 'Debit/Credit Cards',
    entity_id: '',
    company_name: '',
    merchant_account: '',
    external_txn_id: '',
    gross_amount: '',
    foundapay_fee_pct: '',
    merchant_charges: '',
    bearing_merchant_charges: 'Client',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Load lookups
  useEffect(() => {
    let alive = true;
    Promise.all([api.get('/api/clients'), api.get('/api/entities')])
      .then(([cl, en]) => { if (!alive) return; setClients(cl.rows); setEntities(en.rows); })
      .catch((e) => { if (!alive) return; setError(e.message); })
      .finally(() => { if (!alive) return; setLoadingLookups(false); });
    return () => { alive = false; };
  }, []);

  // Esc to close + lock body scroll
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  // Selected client for rate display + reserve rules
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === form.client_id),
    [clients, form.client_id]
  );

  // When client + method are both set, auto-fill FP fee % from the client's rate map
  useEffect(() => {
    if (!selectedClient || !form.payment_method) return;
    const f = METHOD_FIELDS[form.payment_method];
    if (!f) return;
    setForm((s) => ({
      ...s,
      foundapay_fee_pct: (parseFloat(selectedClient[f]) || 0).toString(),
      counterparty_name: s.counterparty_name || selectedClient.name,
    }));
    // eslint-disable-next-line
  }, [form.client_id, form.payment_method]);

  // Live calculation — runs on every input change
  const calc = useMemo(() => {
    const gross = parseFloat(form.gross_amount) || 0;
    const feePct = parseFloat(form.foundapay_fee_pct) || 0;
    const mc = parseFloat(form.merchant_charges) || 0;
    const commission = gross * feePct;

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

  async function save() {
    setError(null);
    if (!form.gross_amount) { setError('Gross amount is required'); return; }
    setSaving(true);
    try {
      const entity = entities.find((e) => e.id === form.entity_id);
      const body = {
        type: form.type,
        date_received: form.date_received,
        status: form.status,
        client_id: form.client_id || null,
        counterparty_type: form.counterparty_type,
        counterparty_name: form.counterparty_name || selectedClient?.name || null,
        payment_method: form.payment_method,
        entity_id: form.entity_id || null,
        company_name: entity?.legal_name || form.company_name || null,
        merchant_account: form.merchant_account || null,
        external_txn_id: form.external_txn_id || null,
        gross_amount: parseFloat(form.gross_amount),
        foundapay_fee_pct: parseFloat(form.foundapay_fee_pct) || 0,
        fee_amount: calc.commission,
        merchant_charges: parseFloat(form.merchant_charges) || 0,
        bearing_merchant_charges: form.bearing_merchant_charges,
        net_amount: calc.net,
        reserve_pct: calc.reserve > 0 ? (calc.reserve / (parseFloat(form.gross_amount) || 1)) : 0,
        reserve_amount: calc.reserve,
        notes: form.notes || null,
      };
      const r = await api.post('/api/transactions', body);
      toast.success(`Transaction #${r.id} saved — ${money(calc.net)}`);
      onSaved?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Backdrop click closes (but not on panel click)
  function onBackdropClick(e) {
    if (e.target === overlayRef.current) onClose?.();
  }

  return (
    <div
      ref={overlayRef}
      onClick={onBackdropClick}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(2px)',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      className="fp-fade-in"
    >
      <aside
        className="fp-slide-in"
        style={{
          width: 560,
          maxWidth: '100vw',
          height: '100vh',
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* HEADER */}
        <header
          style={{
            padding: '18px 20px 14px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              New Transaction
            </h2>
            <p style={{ fontSize: 13, marginTop: 2, color: 'var(--text-secondary)' }}>
              Fast entry — commission auto-calculated
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)', padding: 6, borderRadius: 6,
              display: 'inline-flex',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <X size={18} />
          </button>
        </header>

        {/* SCROLLABLE BODY */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {error && (
            <div
              role="alert"
              style={{
                marginBottom: 14,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.30)',
                borderRadius: 10,
                padding: '10px 12px',
                fontSize: 13,
                color: 'var(--danger)',
              }}
            >{error}</div>
          )}

          {/* Step 1 — Type pills + Date + Status */}
          <SectionHeader>1. Type · Date · Status</SectionHeader>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm((f) => ({ ...f, type: t }))}
                style={pillStyle(form.type === t)}
              >{t}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date_received} onChange={(e) => setForm((f) => ({ ...f, date_received: e.target.value }))} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </div>
          </div>

          {/* Step 2 — Client */}
          <SectionHeader>2. Client</SectionHeader>
          <Select value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))} disabled={loadingLookups}>
            <option value="">{loadingLookups ? 'Loading clients…' : '— Select client —'}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {selectedClient && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--accent)' }}>
              Card: {pctFmt(selectedClient.card_pct)} · Wire: {pctFmt(selectedClient.wire_pct)} · Zelle: {pctFmt(selectedClient.zelle_pct)} · ACH: {pctFmt(selectedClient.ach_pct)} · Cheque: {pctFmt(selectedClient.cheque_pct)}
              {selectedClient.other_terms && (
                <span style={{ color: 'var(--warning)' }}> · {selectedClient.other_terms}</span>
              )}
            </div>
          )}

          {/* Step 3 — Method + Entity */}
          <SectionHeader>3. Method · Entity</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <Label>Payment method</Label>
              <Select value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
                <option>Debit/Credit Cards</option><option>ACH</option><option>Wire Transfer</option><option>Zelle</option><option>Cheque</option><option>PayPal</option>
              </Select>
            </div>
            <div>
              <Label>Entity</Label>
              <Select value={form.entity_id} onChange={(e) => setForm((f) => ({ ...f, entity_id: e.target.value }))} disabled={loadingLookups}>
                <option value="">— Select entity —</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
              </Select>
            </div>
          </div>

          {/* Step 4 — Merchant + External ID */}
          <SectionHeader>4. Merchant · External ID</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <Label>Merchant account</Label>
              <Input placeholder="e.g. Mercury, Authorize.net" value={form.merchant_account} onChange={(e) => setForm((f) => ({ ...f, merchant_account: e.target.value }))} />
            </div>
            <div>
              <Label>External TXN ID <span style={{ opacity: 0.5 }}>(optional)</span></Label>
              <Input value={form.external_txn_id} onChange={(e) => setForm((f) => ({ ...f, external_txn_id: e.target.value }))} />
            </div>
          </div>

          {/* Step 5 — Amounts + live calc */}
          <SectionHeader>5. Amounts</SectionHeader>
          <Label>Gross amount</Label>
          <Input
            type="number" step="0.01" placeholder="0.00"
            value={form.gross_amount}
            onChange={(e) => setForm((f) => ({ ...f, gross_amount: e.target.value }))}
            style={{ height: 48, fontSize: 20, fontWeight: 600 }}
            required
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <Label>Merchant charges</Label>
              <Input
                type="number" step="0.01" placeholder="0.00"
                value={form.merchant_charges}
                onChange={(e) => setForm((f) => ({ ...f, merchant_charges: e.target.value }))}
              />
              <div style={{ marginTop: 8 }}>
                <Label>Who bears merchant charges</Label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['Client', 'FoundaPay'].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, bearing_merchant_charges: b }))}
                      style={{ ...pillStyle(form.bearing_merchant_charges === b), flex: 1 }}
                    >{b}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live calculation card */}
            <div
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                Live calculation
              </div>
              <CalcRow label="Gross" value={money(calc.gross)} />
              <CalcRow
                label="− Commission"
                sub={form.foundapay_fee_pct ? `${(parseFloat(form.foundapay_fee_pct) * 100).toFixed(2)}% of gross` : null}
                value={money(calc.commission)}
                muted
              />
              {calc.mc > 0 && form.bearing_merchant_charges === 'Client' && (
                <CalcRow label="− Merchant charges" value={money(calc.mc)} muted />
              )}
              {calc.reserve > 0 && (
                <CalcRow
                  label="− Reserve"
                  sub={calc.reserveLabel}
                  value={money(calc.reserve)}
                  tone="warning"
                />
              )}
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)' }}>Net to client</div>
                <div
                  style={{
                    fontSize: 22, fontWeight: 700, marginTop: 2,
                    color: calc.net >= 0 ? 'var(--success)' : 'var(--danger)',
                  }}
                >{money(calc.net)}</div>
              </div>
            </div>
          </div>

          {/* Step 6 — Notes */}
          <SectionHeader>6. Notes <span style={{ opacity: 0.5, fontWeight: 400 }}>(optional)</span></SectionHeader>
          <Textarea
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Any additional context…"
          />
        </div>

        {/* STICKY FOOTER */}
        <footer
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Gross <span style={{ color: 'var(--text-primary)', fontFamily: 'ui-monospace, monospace' }}>{money(calc.gross)}</span> {' → '}
            Net <span style={{
              color: calc.net >= 0 ? 'var(--success)' : 'var(--danger)',
              fontFamily: 'ui-monospace, monospace', fontWeight: 600,
            }}>{money(calc.net)}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.gross_amount}>
              {saving ? 'Saving…' : <>Save transaction <ArrowRight size={14} /></>}
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

// ━━━ Helpers ─────────────────────────────────────────────

function SectionHeader({ children }) {
  return (
    <div
      style={{
        marginTop: 18,
        marginBottom: 8,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--text-tertiary)',
      }}
    >{children}</div>
  );
}

function pillStyle(active) {
  return {
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#FFFFFF' : 'var(--text-primary)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 150ms',
  };
}

function CalcRow({ label, sub, value, muted, tone }) {
  const valueColor =
    tone === 'warning' ? 'var(--warning)'
    : muted ? 'var(--text-secondary)'
    : 'var(--text-primary)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '3px 0' }}>
      <div style={{ fontSize: 12 }}>
        <div style={{ color: 'var(--text-primary)' }}>{label}</div>
        {sub && <div style={{ color: 'var(--text-tertiary)', fontSize: 10, marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: valueColor }}>{value}</div>
    </div>
  );
}

function pctFmt(n) {
  const v = parseFloat(n) || 0;
  return `${(v * 100).toFixed(1)}%`;
}
