import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Lock, AlertTriangle, CheckCircle2, XCircle, FileText, RotateCcw } from 'lucide-react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, Badge, money } from './ui';
import { toast } from '../store/toast';
import { downloadReceipt } from '../utils/downloadReceipt';

const PROCESSORS = [
  { id: 'authorize_net', name: 'Authorize.net', fee: '2.9% + $0.30', cb: '$45',  needsCard: true,  available: true  },
  { id: 'payment_cloud', name: 'PaymentCloud',   fee: '4.5% + $0.30', cb: '$25',  needsCard: true,  available: true  },
  { id: 'nmi',           name: 'NMI',            fee: '2.9% + $0.30', cb: '$45',  needsCard: true,  available: true  },
  { id: 'shopify',       name: 'Shopify',        fee: '2.9% + $0.30', cb: 'n/a',  needsCard: false, available: true  },
];

const METHOD_FIELDS = {
  'Debit/Credit Cards': 'card_pct',
  'ACH': 'ach_pct',
  'Wire Transfer': 'wire_pct',
  'Cheque': 'cheque_pct',
  'Zelle': 'zelle_pct',
  'PayPal': 'card_pct',
};

function maskCard(value) {
  return value.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 23);
}
function maskExp(value) {
  const v = value.replace(/\D/g, '').slice(0, 4);
  if (v.length < 3) return v;
  return `${v.slice(0, 2)}/${v.slice(2)}`;
}

export default function ProcessPayment() {
  const [clients, setClients] = useState([]);
  const [entities, setEntities] = useState([]);
  const [processor, setProcessor] = useState(null);
  const [form, setForm] = useState({
    amount: '',
    client_id: '',
    entity_id: '',
    description: '',
    cardNumber: '',
    expiry: '',
    cvv: '',
    cardholder: '',
    customer_email: '',
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/api/clients'), api.get('/api/entities')])
      .then(([cl, en]) => { setClients(cl.rows); setEntities(en.rows); })
      .catch(() => {});
  }, []);

  const selectedClient = useMemo(() => clients.find((c) => c.id === form.client_id), [clients, form.client_id]);

  const calc = useMemo(() => {
    const amount = parseFloat(form.amount) || 0;
    const procFeeRate = 0.029; // best-effort estimate
    const procFixed = amount > 0 ? 0.30 : 0;
    const procFee = amount * procFeeRate + procFixed;
    const fpRate = selectedClient ? (parseFloat(selectedClient.card_pct) || 0) : 0;
    const fpFee = amount * fpRate;
    const net = amount - procFee - fpFee;
    return { amount, procFee, procFeeRate, fpFee, fpRate, net };
  }, [form.amount, selectedClient]);

  const requiresCard = processor?.needsCard;
  const cardValid =
    !requiresCard ||
    (form.cardNumber.replace(/\s+/g, '').length >= 13 && form.expiry.length === 5 && form.cvv.length >= 3);
  const canSubmit = processor && form.amount && cardValid && !busy;

  async function process() {
    setBusy(true);
    setResult(null);
    try {
      const [expMonth, expYear] = form.expiry.split('/');
      const customerName = (form.cardholder || '').trim().split(/\s+/);
      const body = {
        processor: processor.id,
        amount: parseFloat(form.amount),
        description: form.description || `FoundaPay - ${selectedClient?.name || 'direct'}`,
        client_id: form.client_id || null,
        entity_id: form.entity_id || null,
        payment_method: 'Debit/Credit Cards',
        customer: {
          firstName: customerName[0] || '',
          lastName: customerName.slice(1).join(' ') || '',
          email: form.customer_email || undefined,
        },
        ...(requiresCard ? {
          card: {
            number: form.cardNumber.replace(/\s+/g, ''),
            expMonth, expYear,
            cvv: form.cvv,
          },
        } : {}),
      };
      const r = await api.post('/api/virtual-terminal/process-payment', body);
      setResult(r);
      if (r.success) {
        toast.success(`Payment processed: ${r.processorResponse.message}`);
        // Clear card data immediately
        setForm((f) => ({ ...f, cardNumber: '', expiry: '', cvv: '' }));
      } else {
        toast.error(r.error || 'Payment declined');
      }
    } catch (e) {
      setResult({ success: false, error: e.message });
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      {/* LEFT — payment form */}
      <div className="lg:col-span-3 space-y-4">
        {/* Processor selector */}
        <Card className="p-5">
          <SectionTitle>1. Select processor</SectionTitle>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {PROCESSORS.map((p) => {
              const active = processor?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setProcessor(p)}
                  disabled={!p.available}
                  style={{
                    background: active ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                    border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 12,
                    padding: '14px 16px',
                    cursor: p.available ? 'pointer' : 'not-allowed',
                    opacity: p.available ? 1 : 0.5,
                    textAlign: 'left',
                    transition: 'all 150ms',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                    {active && <CheckCircle2 size={16} color="var(--accent)" />}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Fee: <strong>{p.fee}</strong> · CB: <strong>{p.cb}</strong>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Amount + client */}
        <Card className="p-5">
          <SectionTitle>2. Amount &amp; client</SectionTitle>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <Label>Amount (USD)</Label>
              <Input
                type="number" step="0.01" placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                style={{ height: 44, fontSize: 18, fontWeight: 600 }}
              />
            </div>
            <div>
              <Label>Client</Label>
              <Select value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}>
                <option value="">— Select —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Entity</Label>
              <Select value={form.entity_id} onChange={(e) => setForm((f) => ({ ...f, entity_id: e.target.value }))}>
                <option value="">— Select —</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Customer email</Label>
              <Input type="email" value={form.customer_email} onChange={(e) => setForm((f) => ({ ...f, customer_email: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Description / invoice #</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
        </Card>

        {/* Card details */}
        {processor && requiresCard && (
          <Card className="p-5">
            <SectionTitle>3. Card details</SectionTitle>

            <div
              role="alert"
              style={{
                marginTop: 10, marginBottom: 14,
                background: 'var(--warning-bg)',
                color: 'var(--warning-fg)',
                border: '1px solid var(--warning)',
                borderRadius: 10, padding: '10px 12px',
                fontSize: 12, lineHeight: 1.5,
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>PCI scope warning:</strong> raw card numbers travel through this server.
                Card data is <strong>never stored</strong> in the database (only the last 4 digits),
                but accepting PAN here triggers PCI DSS SAQ-D compliance scope. For production,
                switch to the processor's hosted fields (Accept.js / Collect.js) which return a
                payment nonce instead.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Card number</Label>
                <div style={{ position: 'relative' }}>
                  <CreditCard size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                  <Input
                    inputMode="numeric"
                    autoComplete="cc-number"
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
                  maxLength={4}
                  placeholder="•••"
                  value={form.cvv}
                  onChange={(e) => setForm((f) => ({ ...f, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                />
              </div>
              <div className="col-span-2">
                <Label>Cardholder name</Label>
                <Input autoComplete="cc-name" value={form.cardholder} onChange={(e) => setForm((f) => ({ ...f, cardholder: e.target.value }))} />
              </div>
            </div>
          </Card>
        )}

        {/* Submit */}
        <Button onClick={process} disabled={!canSubmit} size="lg" className="w-full">
          <Lock size={14} />
          {busy
            ? `Processing via ${processor?.name}…`
            : processor
              ? `Process payment — ${money(parseFloat(form.amount) || 0)}`
              : 'Select a processor first'}
        </Button>
      </div>

      {/* RIGHT — live summary + result */}
      <div className="lg:col-span-2 space-y-4">
        <Card className="p-5">
          <SectionTitle>Live summary</SectionTitle>
          <Row label="Amount" value={money(calc.amount)} />
          <Row label={`Processor fee (~${(calc.procFeeRate * 100).toFixed(1)}%)`} value={`-${money(calc.procFee)}`} muted />
          {calc.fpFee > 0 && <Row label={`FoundaPay commission (${(calc.fpRate * 100).toFixed(1)}%)`} value={`-${money(calc.fpFee)}`} muted />}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>Net to client</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: calc.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {money(calc.net)}
            </div>
          </div>
        </Card>

        {result?.success && (
          <Card style={{ borderLeft: '3px solid var(--success)' }} className="p-5">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <CheckCircle2 size={18} color="var(--success)" />
              <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Payment processed</h3>
            </div>
            <Row label="Processor TXN" value={result.processorResponse.transactionId} />
            <Row label="Auth code" value={result.processorResponse.authCode || '—'} />
            <Row label="Last 4" value={result.processorResponse.last4 ? `••${result.processorResponse.last4}` : '—'} />
            <Row label="DB transaction" value={`#${result.transaction.id}`} />
            <Row label="Net to client" value={money(result.transaction.net_amount)} />
            <Button variant="secondary" className="w-full mt-3" onClick={() => downloadReceipt(result.transaction.id)}>
              <FileText size={14} /> Download receipt PDF
            </Button>
          </Card>
        )}

        {result && !result.success && (
          <Card style={{ borderLeft: '3px solid var(--danger)' }} className="p-5">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <XCircle size={18} color="var(--danger)" />
              <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Payment declined</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{result.error || 'Unknown error'}</p>
            <Button variant="secondary" onClick={() => setResult(null)}><RotateCcw size={14} /> Try again</Button>
          </Card>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
      {children}
    </div>
  );
}
function Row({ label, value, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ fontSize: 12, color: muted ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: muted ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
