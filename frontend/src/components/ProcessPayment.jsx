import React, { useEffect, useMemo, useState } from 'react';
import {
  CreditCard, Link2, Lock, AlertTriangle, CheckCircle2, XCircle, FileText,
  RotateCcw, Copy, Check, Activity,
} from 'lucide-react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, Badge, money } from './ui';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';
import { downloadReceipt } from '../utils/downloadReceipt';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Calc convention (used everywhere now):
//   - Field DISPLAYS percentage (e.g. "30")
//   - DB STORES decimal (e.g. 0.30)
//   - On calc:  feePctDecimal = displayValue / 100
//   - On display: displayValue = decimal × 100
//   - On save: send decimal to backend
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const RESERVE_RULES = {
  'DND':      { pct: 0.10, basis: 'gross',          label: '10% of Gross' },
  'Azeem':    { pct: 0.10, basis: 'gross_minus_mc', label: '10% of (Gross − Merchant Charges)' },
  'Husk SOL': { pct: 0.10, basis: 'gross_minus_mc', label: '10% of (Gross − Merchant Charges)' },
};

const EXPIRY_OPTIONS = [
  { v: 15,    label: '15 min' },
  { v: 30,    label: '30 min' },
  { v: 60,    label: '1 hr' },
  { v: 1440,  label: '24 hrs' },
];

function maskCard(value) {
  return value.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 23);
}
function maskExp(value) {
  const v = value.replace(/\D/g, '').slice(0, 4);
  if (v.length < 3) return v;
  return `${v.slice(0, 2)}/${v.slice(2)}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function ProcessPayment() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const isClientUser = user?.role === 'client_user';
  // Only super_admin may edit the FP fee % (override). Everyone else sees a
  // locked, read-only field. client_user never sees it at all.
  const feePctReadOnly = !isSuperAdmin;

  const [chargeType, setChargeType] = useState('direct'); // 'direct' | 'link'

  const [clients, setClients] = useState([]);
  const [entities, setEntities] = useState([]);
  const [authConfig, setAuthConfig] = useState(null);
  const [authStatus, setAuthStatus] = useState(null);
  const [todayList, setTodayList] = useState([]);

  const [form, setForm] = useState({
    amount: '',
    description: '',
    invoiceNumber: `INV-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13)}`,
    client_id: '',
    entity_id: '',
    foundapay_fee_pct_display: '', // displayed as percentage e.g. "30"
    customer_email: '',
    cardNumber: '',
    expiry: '',
    cvv: '',
    cardholder: '',
    customerFirst: '',
    customerLast: '',
    customerPhone: '',
    save_to_ledger: true,
    expiry_minutes: 1440, // 24h default — matches new backend
    return_url: '', // optional override; backend defaults to ${PORTAL_URL}/pay/success
    brand_name: '',
    logo_type: 'entity',
  });
  const [showCustomer, setShowCustomer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [linkSecondsLeft, setLinkSecondsLeft] = useState(0);

  // Load lookups + Authorize.net status
  useEffect(() => {
    Promise.all([
      api.get('/api/clients'),
      api.get('/api/entities'),
      api.get('/api/vt/public-config'),
    ]).then(([cl, en, cfg]) => {
      setClients(cl.rows);
      setEntities(en.rows);
      setAuthConfig(cfg);
      const designory = en.rows.find((e) => /designory/i.test(e.legal_name));
      if (designory) {
        setForm((f) => ({ ...f, entity_id: designory.id, brand_name: cfg.entity || designory.legal_name }));
      }
    }).catch(() => {});
    refreshTodayList();
    // eslint-disable-next-line
  }, []);

  async function refreshTodayList() {
    try {
      const r = await api.get('/api/vt/transactions');
      const today = new Date().toISOString().slice(0, 10);
      setTodayList(r.rows.filter((vt) => vt.created_at?.slice(0, 10) === today));
    } catch { /* ignore */ }
  }

  async function testAuthnet() {
    setAuthStatus({ loading: true });
    try {
      const r = await api.get('/api/vt/test');
      setAuthStatus(r);
      toast[r.success ? 'success' : 'error'](r.message);
    } catch (e) {
      setAuthStatus({ success: false, message: e.message });
      toast.error(e.message);
    }
  }

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === form.client_id),
    [clients, form.client_id]
  );

  // Auto-fill fee% when client changes — convert decimal × 100 for display
  useEffect(() => {
    if (!selectedClient) return;
    const decimal = parseFloat(selectedClient.card_pct) || 0;
    setForm((s) => ({
      ...s,
      foundapay_fee_pct_display: (decimal * 100).toFixed(2),
    }));
  }, [form.client_id, selectedClient]);

  // ━━━ Live calc — divide display by 100 ━━━
  const calc = useMemo(() => {
    const gross = parseFloat(form.amount) || 0;
    const feePctDisplay = parseFloat(form.foundapay_fee_pct_display) || 0;
    const feePctDecimal = feePctDisplay / 100;
    const commission = gross * feePctDecimal;

    let reserve = 0;
    let reserveLabel = '';
    if (selectedClient) {
      const rule = RESERVE_RULES[selectedClient.name];
      if (rule) {
        const base = rule.basis === 'gross' ? gross : gross; // direct charge: MC = 0
        reserve = base * rule.pct;
        reserveLabel = rule.label;
      }
    }

    const netToClient = gross - commission - reserve;
    const fpTotal = commission + reserve;

    return { gross, commission, reserve, reserveLabel, netToClient, fpTotal, feePctDecimal, feePctDisplay };
  }, [form.amount, form.foundapay_fee_pct_display, selectedClient]);

  // Countdown for hosted-link expiration
  useEffect(() => {
    if (!result?.expiresAt) return;
    const end = new Date(result.expiresAt).getTime();
    const tick = () => setLinkSecondsLeft(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [result?.expiresAt]);

  const requiredOk =
    chargeType === 'direct'
      ? form.amount && form.cardNumber.replace(/\s+/g, '').length >= 13 && form.expiry.length === 5 && form.cvv.length >= 3
      : !!form.amount;

  async function process() {
    setBusy(true);
    setResult(null);
    try {
      if (chargeType === 'direct') {
        const body = {
          amount: parseFloat(form.amount),
          description: form.description || `FoundaPay - ${selectedClient?.name || 'direct'}`,
          invoiceNumber: form.invoiceNumber,
          client_id: form.client_id || null,
          entity_id: form.entity_id || null,
          customer: {
            firstName: form.customerFirst || form.cardholder.split(/\s+/)[0] || '',
            lastName: form.customerLast || form.cardholder.split(/\s+/).slice(1).join(' ') || '',
            email: form.customer_email || undefined,
            phone: form.customerPhone || undefined,
          },
          card: {
            number: form.cardNumber.replace(/\s+/g, ''),
            expiry: form.expiry,
            cvv: form.cvv,
          },
          save_to_ledger: form.save_to_ledger,
          foundapay_fee_pct: calc.feePctDecimal, // backend stores decimal
          logo_type: form.logo_type,
          brand_name: form.brand_name,
        };
        const r = await api.post('/api/vt/charge', body);
        setResult({ ...r, kind: 'direct' });
        if (r.success) {
          toast.success(`Approved · ${money(parseFloat(form.amount))}`);
          setForm((f) => ({ ...f, cardNumber: '', expiry: '', cvv: '' }));
          refreshTodayList();
        } else {
          toast.error(r.message || 'Declined');
        }
      } else {
        const ru = (form.return_url || '').trim();
        if (ru && !/^https:\/\//i.test(ru)) {
          toast.error('Return URL must start with https://');
          return;
        }
        const body = {
          amount: parseFloat(form.amount),
          description: form.description,
          invoiceNumber: form.invoiceNumber,
          customer_email: form.customer_email || undefined,
          client_id: form.client_id || null,
          entity_id: form.entity_id || null,
          brand_name: form.brand_name || authConfig?.entity || 'FoundaPay',
          logo_type: form.logo_type,
          expiry_minutes: parseInt(form.expiry_minutes, 10),
          method: 'self_hosted',
          return_url: ru || undefined,
        };
        const r = await api.post('/api/vt/generate-link', body);
        if (r?.hostedUrl && !/^https:\/\/portal\.foundapay\.com\/pay\//.test(r.hostedUrl)) {
          toast.error('Generated link is not on the portal domain. Check PORTAL_URL on the server.');
          setResult({ success: false, error: `Bad link host: ${r.hostedUrl}` });
          return;
        }
        setResult({ ...r, kind: 'link' });
        if (r.success) {
          toast.success('Payment link generated');
          refreshTodayList();
        } else {
          toast.error(r.error || 'Failed to generate link');
        }
      }
    } catch (e) {
      setResult({ success: false, error: e.message });
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!result?.hostedUrl) return;
    navigator.clipboard.writeText(result.hostedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      {/* LEFT — form */}
      <div className="lg:col-span-3 space-y-4">
        {/* Charge type selector */}
        <Card className="p-5">
          <SectionTitle>Charge type</SectionTitle>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <ChargeCard
              icon={CreditCard}
              title="Direct Charge"
              sub="Enter card details now"
              active={chargeType === 'direct'}
              onClick={() => { setChargeType('direct'); setResult(null); }}
            />
            <ChargeCard
              icon={Link2}
              title="Payment Link"
              sub="Send URL or QR to customer"
              active={chargeType === 'link'}
              onClick={() => { setChargeType('link'); setResult(null); }}
            />
          </div>

          {/* Authorize.net status badge */}
          <div
            style={{
              marginTop: 14, padding: '8px 12px', borderRadius: 8,
              background: authConfig?.sandbox ? 'var(--warning-bg)' : 'var(--success-bg)',
              color: authConfig?.sandbox ? 'var(--warning-fg)' : 'var(--success-fg)',
              fontSize: 12,
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: authConfig?.sandbox ? '#F59E0B' : '#10B981',
              boxShadow: '0 0 0 3px rgba(255,255,255,0.15)',
            }} />
            <span>
              <strong>Authorize.net {authConfig?.sandbox ? 'SANDBOX' : 'LIVE'}</strong>
              {authConfig?.entity && <> — {authConfig.entity}</>}
            </span>
            <span style={{ flex: 1 }} />
            <button
              onClick={testAuthnet}
              disabled={authStatus?.loading}
              style={{
                background: 'transparent', border: '1px solid currentColor',
                color: 'inherit', borderRadius: 6, padding: '2px 8px',
                fontSize: 11, cursor: 'pointer', fontWeight: 500,
              }}
            >
              {authStatus?.loading ? 'Testing…' : 'Test connection'}
            </button>
          </div>
        </Card>

        {/* Amount + invoice + description */}
        <Card className="p-5">
          <SectionTitle>Amount &amp; details</SectionTitle>
          <div className="mt-2">
            <Label>Amount (USD)</Label>
            <Input
              type="number" step="0.01" placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              style={{ height: 48, fontSize: 22, fontWeight: 600 }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label>Invoice #</Label>
              <Input value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} />
            </div>
          </div>
        </Card>

        {/* Client + entity + fee */}
        <Card className="p-5">
          <SectionTitle>Client &amp; entity</SectionTitle>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <Label>Client</Label>
              <Select value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}>
                <option value="">— Select client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Entity</Label>
              <Select value={form.entity_id} onChange={(e) => setForm((f) => ({ ...f, entity_id: e.target.value }))}>
                <option value="">— Select entity —</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
              </Select>
            </div>
          </div>

          {!isClientUser && (
            <div className="mt-3">
              <Label>FoundaPay fee %</Label>
              <div style={{ position: 'relative' }}>
                <Input
                  type="number" step="0.01"
                  value={form.foundapay_fee_pct_display}
                  onChange={(e) => setForm((f) => ({ ...f, foundapay_fee_pct_display: e.target.value }))}
                  readOnly={feePctReadOnly}
                  title={feePctReadOnly ? 'Rate set by client agreement. Contact a super admin to override.' : undefined}
                  style={{
                    background: feePctReadOnly ? 'var(--bg-hover)' : 'var(--input-bg)',
                    color: feePctReadOnly ? 'var(--text-secondary)' : 'var(--input-text)',
                    paddingRight: 40,
                    cursor: feePctReadOnly ? 'not-allowed' : 'text',
                  }}
                />
                {feePctReadOnly && (
                  <Lock size={14} style={{
                    position: 'absolute', right: 12, top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-tertiary)', pointerEvents: 'none',
                  }} />
                )}
              </div>
              {feePctReadOnly && (
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Locked. Set by client agreement — contact a super admin to override.
                </p>
              )}
              {isSuperAdmin && selectedClient && (
                <p style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
                  ⚠ Overriding {selectedClient.name}'s rate ({(parseFloat(selectedClient.card_pct) * 100).toFixed(1)}%) — change applies to this transaction only.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Branding */}
        <Card className="p-5">
          <SectionTitle>Branding (shown on payment page)</SectionTitle>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <Label>Logo</Label>
              <Select value={form.logo_type} onChange={(e) => setForm((f) => ({ ...f, logo_type: e.target.value }))}>
                <option value="entity">Entity name</option>
                <option value="custom">Custom logo</option>
                <option value="none">No logo</option>
              </Select>
            </div>
            <div>
              <Label>Brand name</Label>
              <Input value={form.brand_name} onChange={(e) => setForm((f) => ({ ...f, brand_name: e.target.value }))} placeholder="Designory Inc" />
            </div>
          </div>
        </Card>

        {/* Direct charge: card + customer */}
        {chargeType === 'direct' && (
          <>
            <Card className="p-5">
              <div style={{
                marginBottom: 14, padding: '10px 12px',
                background: 'var(--warning-bg)', color: 'var(--warning-fg)',
                border: '1px solid var(--warning)', borderRadius: 10,
                fontSize: 12, lineHeight: 1.5,
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <strong>PCI scope:</strong> raw PAN passes through this server.
                  Card numbers are <strong>never stored</strong> — only the last 4 digits — but accepting cards
                  here triggers PCI DSS SAQ-D compliance scope. Switch to Authorize.net <strong>Accept.js</strong>
                  to drop to SAQ-A (your Public Client Key is already wired).
                </div>
              </div>

              <SectionTitle>🔒 Card details</SectionTitle>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="col-span-2">
                  <Label>Card number</Label>
                  <div style={{ position: 'relative' }}>
                    <CreditCard size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                    <Input
                      inputMode="numeric" autoComplete="cc-number"
                      placeholder="•••• •••• •••• ••••"
                      value={form.cardNumber}
                      onChange={(e) => setForm((f) => ({ ...f, cardNumber: maskCard(e.target.value) }))}
                      style={{ paddingLeft: 36, fontFamily: 'ui-monospace, monospace', letterSpacing: 1.5 }}
                    />
                  </div>
                </div>
                <div>
                  <Label>Expiry (MM/YY)</Label>
                  <Input
                    inputMode="numeric" autoComplete="cc-exp"
                    placeholder="MM/YY"
                    value={form.expiry}
                    onChange={(e) => setForm((f) => ({ ...f, expiry: maskExp(e.target.value) }))}
                  />
                </div>
                <div>
                  <Label>CVV</Label>
                  <Input
                    type="password" inputMode="numeric" autoComplete="cc-csc"
                    maxLength={4} placeholder="•••"
                    value={form.cvv}
                    onChange={(e) => setForm((f) => ({ ...f, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Cardholder name</Label>
                  <Input autoComplete="cc-name" value={form.cardholder} onChange={(e) => setForm((f) => ({ ...f, cardholder: e.target.value }))} />
                </div>
              </div>

              {authConfig?.sandbox && (
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, fontFamily: 'monospace' }}>
                  Test card: 4111111111111111 · Exp: 12/26 · CVV: 123
                </p>
              )}
            </Card>

            <Card className="p-5">
              <button
                onClick={() => setShowCustomer(!showCustomer)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 500, padding: 0 }}
              >
                {showCustomer ? '▾' : '▸'} Customer details (optional)
              </button>
              {showCustomer && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div><Label>First name</Label><Input value={form.customerFirst} onChange={(e) => setForm((f) => ({ ...f, customerFirst: e.target.value }))} /></div>
                  <div><Label>Last name</Label><Input value={form.customerLast} onChange={(e) => setForm((f) => ({ ...f, customerLast: e.target.value }))} /></div>
                  <div><Label>Email (receipt)</Label><Input type="email" value={form.customer_email} onChange={(e) => setForm((f) => ({ ...f, customer_email: e.target.value }))} /></div>
                  <div><Label>Phone</Label><Input value={form.customerPhone} onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))} /></div>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={form.save_to_ledger}
                  onChange={(e) => setForm((f) => ({ ...f, save_to_ledger: e.target.checked }))}
                />
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                  Auto-save to Master Ledger after successful charge
                </span>
              </label>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, paddingLeft: 26 }}>
                Commission auto-calculated from client rate. Reserve auto-applied if rule matches.
              </p>
            </Card>
          </>
        )}

        {/* Payment link options */}
        {chargeType === 'link' && (
          <Card className="p-5">
            <SectionTitle>Link options</SectionTitle>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="col-span-2">
                <Label>Customer email (optional)</Label>
                <Input type="email" placeholder="customer@example.com"
                  value={form.customer_email}
                  onChange={(e) => setForm((f) => ({ ...f, customer_email: e.target.value }))}
                />
              </div>
              <div>
                <Label>Link expires</Label>
                <Select value={form.expiry_minutes} onChange={(e) => setForm((f) => ({ ...f, expiry_minutes: e.target.value }))}>
                  {EXPIRY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </Select>
              </div>
              <div>
                <Label>Return URL <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span></Label>
                <Input
                  placeholder="Leave blank for default success page"
                  value={form.return_url}
                  onChange={(e) => setForm((f) => ({ ...f, return_url: e.target.value }))}
                />
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 12 }}>
              Secure payment page hosted on FoundaPay. Card data is tokenized via
              Authorize.net Accept.js — never stored on our servers.
            </p>
          </Card>
        )}

        {/* Submit */}
        <Button onClick={process} disabled={!requiredOk || busy} size="lg" className="w-full">
          <Lock size={14} />
          {busy
            ? `Processing via Authorize.net…`
            : chargeType === 'direct'
              ? `Charge ${money(calc.gross)} via Authorize.net →`
              : `Generate payment link → ${money(calc.gross)}`}
        </Button>
      </div>

      {/* RIGHT — calc + result */}
      <div className="lg:col-span-2 space-y-4">
        {/* Client Settlement */}
        <Card className="p-5" style={{ borderLeft: '3px solid var(--success)' }}>
          <SectionTitle>💰 Client Settlement</SectionTitle>
          <div className="mt-3 space-y-1.5">
            <Row label="Gross amount" value={money(calc.gross)} />
            {calc.commission > 0 && (
              <Row label={`− FP commission (${calc.feePctDisplay.toFixed(2)}%)`} value={money(calc.commission)} muted />
            )}
            {calc.reserve > 0 && (
              <Row label={`− Reserve hold`} sub={calc.reserveLabel} value={money(calc.reserve)} muted />
            )}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
                Net to client
              </div>
              <div style={{
                fontSize: 26, fontWeight: 700, marginTop: 2,
                color: calc.netToClient >= 0 ? 'var(--success)' : 'var(--danger)',
              }}>{money(calc.netToClient)}</div>
            </div>
          </div>
        </Card>

        {/* FoundaPay Revenue — staff only */}
        {!isClientUser && (
          <Card className="p-5" style={{ borderLeft: '3px solid var(--accent)' }}>
            <SectionTitle>📊 FoundaPay Revenue</SectionTitle>
            <div className="mt-3 space-y-1.5">
              <Row label={`Commission (${calc.feePctDisplay.toFixed(2)}%)`} value={money(calc.commission)} tone="success" />
              {calc.reserve > 0 && <Row label="Reserve held" value={money(calc.reserve)} tone="info" sub="released after period" />}
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
                  FP total earned
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2, color: 'var(--accent)' }}>
                  {money(calc.fpTotal)}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Result — direct charge */}
        {result?.success && result.kind === 'direct' && (
          <Card className="p-5" style={{ borderLeft: '3px solid var(--success)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <CheckCircle2 size={18} color="var(--success)" />
              <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Payment approved</h3>
            </div>
            <Row label="Amount" value={money(parseFloat(form.amount || calc.gross))} />
            <Row label="Auth code" value={result.authCode || '—'} mono />
            <Row label="Trans ID" value={result.transactionId || '—'} mono />
            <Row label="Card" value={`${result.accountType || 'Card'} ••${result.last4 || '—'}`} />
            <Row label="VT row" value={result.vtTransactionId?.slice(0, 8)} mono />
            <div className="mt-3 grid grid-cols-2 gap-2">
              {result.transaction?.id && (
                <Button variant="secondary" onClick={() => downloadReceipt(result.transaction.id)}>
                  <FileText size={14} /> Receipt PDF
                </Button>
              )}
              <Button variant="secondary" onClick={() => setResult(null)}>+ New transaction</Button>
            </div>
          </Card>
        )}

        {/* Result — payment link */}
        {result?.success && result.kind === 'link' && (
          <Card className="p-5" style={{ borderLeft: '3px solid var(--accent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Link2 size={18} color="var(--accent)" />
              <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Payment link generated</h3>
            </div>
            {result.qrCode && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <img src={result.qrCode} alt="QR code"
                  style={{ width: 180, height: 180, borderRadius: 10, border: '1px solid var(--border)' }} />
              </div>
            )}
            <div style={{
              padding: '8px 10px', borderRadius: 8,
              background: 'var(--bg-tertiary)', fontFamily: 'monospace', fontSize: 11,
              color: 'var(--text-secondary)', wordBreak: 'break-all', marginBottom: 8,
            }}>{result.hostedUrl}</div>
            {linkSecondsLeft > 0 && (
              <div style={{
                fontSize: 12, color: 'var(--warning)',
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
              }}>
                <Activity size={14} />
                Expires in {Math.floor(linkSecondsLeft / 60)}:{String(linkSecondsLeft % 60).padStart(2, '0')}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={copyLink}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button variant="secondary" onClick={() => window.open(result.hostedUrl, '_blank')}>
                Open page
              </Button>
            </div>
          </Card>
        )}

        {/* Result — declined */}
        {result && !result.success && (
          <Card className="p-5" style={{ borderLeft: '3px solid var(--danger)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <XCircle size={18} color="var(--danger)" />
              <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Payment declined</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>
              {result.error || result.message || 'Unknown error'}
            </p>
            <Button variant="secondary" onClick={() => setResult(null)}>
              <RotateCcw size={14} /> Try again
            </Button>
          </Card>
        )}

        {/* Today's VT charges */}
        {todayList.length > 0 && (
          <Card className="p-4">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h4 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
                Today's charges
              </h4>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {todayList.length} · {money(todayList.reduce((s, vt) => s + parseFloat(vt.amount || 0), 0))}
              </span>
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {todayList.map((vt) => (
                <div
                  key={vt.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 0', fontSize: 12,
                    borderBottom: '1px solid var(--border-light)',
                  }}
                >
                  <span style={{ width: 36, color: 'var(--text-tertiary)' }}>
                    {vt.created_at ? new Date(vt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                  <Badge tone={vt.charge_type === 'direct_charge' ? 'accent' : 'info'}>
                    {vt.charge_type === 'direct_charge' ? 'Direct' : 'Link'}
                  </Badge>
                  <span style={{ flex: 1, fontFamily: 'monospace' }}>
                    {vt.card_last4 ? `••${vt.card_last4}` : '—'}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {money(vt.amount)}
                  </span>
                  <Badge tone={vt.status === 'success' ? 'success' : vt.status === 'pending' ? 'info' : 'danger'}>
                    {vt.status}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ━━━ helpers ─────────────────────────────────────────────
function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      color: 'var(--text-secondary)',
    }}>{children}</div>
  );
}

function ChargeCard({ icon: Icon, title, sub, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
        border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 12, padding: '14px 16px',
        cursor: 'pointer', textAlign: 'left',
        transition: 'all 150ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Icon size={18} color={active ? 'var(--accent)' : 'var(--text-secondary)'} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sub}</div>
    </button>
  );
}

function Row({ label, sub, value, muted, tone, mono }) {
  const c = tone === 'success' ? 'var(--success)'
          : tone === 'info' ? 'var(--info)'
          : muted ? 'var(--text-secondary)'
          : 'var(--text-primary)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 0' }}>
      <div style={{ fontSize: 12 }}>
        <div style={{ color: muted ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{label}</div>
        {sub && <div style={{ color: 'var(--text-tertiary)', fontSize: 10, marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: c }}>
        {value}
      </div>
    </div>
  );
}
