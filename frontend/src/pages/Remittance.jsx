// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Remittance — channel-agnostic outbound money page.
//
// Channels: Wise (automated API), Manual Wire (records-only),
// SWIFT, ACH (stubs).  Wise *balances* live on /banks now,
// not here — this page is purely transfer history + new transfer.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useEffect, useMemo, useState } from 'react';
import {
  Send, RefreshCw, Plus, Upload, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Textarea, Label, PageHeader, Modal, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';

const STATUS_DISPLAY = {
  draft:             { label: 'Draft',             tone: 'neutral' },
  quote_created:     { label: 'Quoted',            tone: 'info' },
  transfer_created:  { label: 'Transfer created',  tone: 'info' },
  processing:        { label: 'Processing',        tone: 'info' },
  sent:              { label: 'Sent',              tone: 'accent' },
  completed:         { label: 'Completed ✅',       tone: 'success' },
  failed:            { label: 'Failed ❌',          tone: 'danger' },
  cancelled:         { label: 'Cancelled',         tone: 'neutral' },
};

const CHANNEL_LABEL = {
  wise:   { icon: '🌐', label: 'Wise' },
  manual: { icon: '📋', label: 'Manual Wire' },
  swift:  { icon: '🏛',  label: 'SWIFT' },
  ach:    { icon: '🏧', label: 'ACH' },
};

// Pakistani-bank dropdown options + a guess at SWIFT/BIC for each.
const PK_BANKS = [
  { name: 'Meezan Bank',                   swift: 'MEZNPKKA' },
  { name: 'HBL (Habib Bank Limited)',      swift: 'HABBPKKA' },
  { name: 'UBL (United Bank Limited)',     swift: 'UNILPKKA' },
  { name: 'Allied Bank',                   swift: 'ABPAPKKA' },
  { name: 'Bank Alfalah',                  swift: 'ALFHPKKA' },
  { name: 'MCB Bank',                      swift: 'MUCBPKKA' },
  { name: 'Standard Chartered Pakistan',   swift: 'SCBLPKKX' },
  { name: 'Faysal Bank',                   swift: 'FAYSPKKA' },
  { name: 'NBP (National Bank of Pakistan)', swift: 'NBPAPKKA' },
  { name: 'Askari Bank',                   swift: 'ASCMPKKA' },
  { name: 'Habib Metropolitan Bank',       swift: 'MPBLPKKA' },
  { name: 'Other',                         swift: '' },
];

const COUNTRIES = [
  { code: 'PK', label: 'Pakistan',     currency: 'PKR' },
  { code: 'US', label: 'United States', currency: 'USD' },
  { code: 'GB', label: 'United Kingdom', currency: 'GBP' },
  { code: 'IN', label: 'India',        currency: 'INR' },
  { code: 'PH', label: 'Philippines',  currency: 'PHP' },
  { code: 'BD', label: 'Bangladesh',   currency: 'BDT' },
  { code: 'AE', label: 'UAE',          currency: 'AED' },
  { code: 'EG', label: 'Egypt',        currency: 'EGP' },
  { code: 'XX', label: 'Other',        currency: 'USD' },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function Remittance() {
  const { user: me } = useAuth();
  const isSuper = ['super_admin', 'owner'].includes(me?.role);

  const [providers, setProviders] = useState([]);
  const [tab, setTab] = useState('all'); // all | wise | manual | swift | ach
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openTransfer, setOpenTransfer] = useState(false);

  async function loadRows() {
    setLoading(true);
    try {
      const r = await api.get('/api/wise');
      setRows(r.rows);
    } finally { setLoading(false); }
  }
  useEffect(() => {
    api.get('/api/wise/providers').then((r) => setProviders(r.providers || [])).catch(() => {});
    loadRows();
  }, []);

  async function syncAll() {
    try {
      const r = await api.post('/api/wise/sync', {});
      toast.success(`Synced ${r.updated} Wise transfers`);
      loadRows();
    } catch (e) { toast.error(e.message); }
  }

  async function fundOne(row) {
    if (!isSuper) return;
    if (!window.confirm(`Fund $${row.source_amount} ${row.source_currency} to ${row.recipient_name}? Deducts from Wise balance.`)) return;
    try {
      await api.post(`/api/wise/transfer/${row.id}/fund`, {});
      toast.success('Funded');
      loadRows();
    } catch (e) { toast.error(e.message); }
  }

  const filteredRows = useMemo(() => {
    if (tab === 'all') return rows;
    return rows.filter((r) => (r.provider || 'wise') === tab);
  }, [rows, tab]);

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Remittance 💸"
        subtitle="Outbound money — Wise / Manual Wire / SWIFT / ACH"
        actions={isSuper && (
          <Button onClick={() => setOpenTransfer(true)}><Plus size={14} /> New Transfer</Button>
        )}
      />

      {/* Channel filter tabs */}
      <Card className="p-2 mb-3">
        <div className="flex flex-wrap gap-1">
          <ChannelTab id="all" active={tab === 'all'} onClick={setTab} count={rows.length}>🏦 All</ChannelTab>
          {['wise', 'manual', 'swift', 'ach'].map((id) => {
            const cnt = rows.filter((r) => (r.provider || 'wise') === id).length;
            const cfg = CHANNEL_LABEL[id];
            return (
              <ChannelTab key={id} id={id} active={tab === id} onClick={setTab} count={cnt}>
                {cfg.icon} {cfg.label}
              </ChannelTab>
            );
          })}
        </div>
      </Card>

      {/* Hint to find Wise balances now */}
      <div className="mb-3" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
        Wise balances moved to <a href="/banks" style={{ color: 'var(--accent)' }}>Bank Accounts</a> —
        this page is now transfers only.
      </div>

      <Card>
        <div className="flex items-center justify-between" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
            Transfer history ({filteredRows.length})
          </div>
          <Button variant="secondary" size="sm" onClick={syncAll}><RefreshCw size={12} /> Sync from Wise</Button>
        </div>
        <Table>
          <Thead>
            <Tr>
              <Th>Date</Th>
              <Th>Channel</Th>
              <Th>Recipient</Th>
              <Th className="text-right">Sent</Th>
              <Th className="text-right">Recipient gets</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Fee</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <tbody>
            {loading && <Tr><Td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</Td></Tr>}
            {!loading && filteredRows.length === 0 && (
              <Tr><Td colSpan="9" style={{ textAlign: 'center', padding: 28, color: 'var(--text-secondary)' }}>
                No transfers {tab !== 'all' && `via ${CHANNEL_LABEL[tab]?.label}`} yet. {isSuper && (
                  <button onClick={() => setOpenTransfer(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
                    Send your first transfer →
                  </button>
                )}
              </Td></Tr>
            )}
            {!loading && filteredRows.map((r) => {
              const sd = STATUS_DISPLAY[r.status] || { label: r.status, tone: 'neutral' };
              const ch = CHANNEL_LABEL[r.provider || 'wise'] || CHANNEL_LABEL.wise;
              return (
                <Tr key={r.id}>
                  <Td className="text-xs">{dateOnly(r.created_at)}</Td>
                  <Td><Badge tone="info">{ch.icon} {ch.label}</Badge></Td>
                  <Td>
                    <div style={{ fontSize: 12 }}>{r.recipient_name || '—'}</div>
                    {r.recipient_account && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{r.recipient_account}</div>}
                  </Td>
                  <Td className="text-right font-mono">{money(r.source_amount, r.source_currency)}</Td>
                  <Td className="text-right font-mono">{money(r.target_amount, r.target_currency)}</Td>
                  <Td className="text-right font-mono">{r.exchange_rate ? Number(r.exchange_rate).toFixed(4) : '—'}</Td>
                  <Td className="text-right font-mono">{r.wise_fee != null ? money(r.wise_fee, r.source_currency) : (r.provider_fee != null ? money(r.provider_fee, r.source_currency) : '—')}</Td>
                  <Td><Badge tone={sd.tone}>{sd.label}</Badge></Td>
                  <Td>
                    <div className="flex gap-1 flex-wrap">
                      {(r.provider || 'wise') === 'wise' && r.status === 'transfer_created' && isSuper && (
                        <Button size="sm" variant="success" onClick={() => fundOne(r)}>Fund</Button>
                      )}
                      {r.wise_transfer_id && (r.provider || 'wise') === 'wise' && (
                        <a href={`https://wise.com/transfer/${r.wise_transfer_id}`} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, color: 'var(--accent)' }}>View on Wise →</a>
                      )}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {openTransfer && (
        <TransferModal
          providers={providers}
          onClose={() => setOpenTransfer(false)}
          onCreated={() => { setOpenTransfer(false); loadRows(); }}
        />
      )}
    </div>
  );
}

function ChannelTab({ id, active, onClick, count, children }) {
  return (
    <button onClick={() => onClick(id)}
      style={{
        padding: '6px 14px', borderRadius: 8, border: 'none',
        background: active ? 'var(--bg-hover)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 13, fontWeight: 500, cursor: 'pointer',
      }}>
      {children}
      {count != null && <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>· {count}</span>}
    </button>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4-step Channel-First Transfer Modal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function TransferModal({ providers, onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [channel, setChannel] = useState(null); // 'wise' | 'manual'

  // Recipient state
  const [country, setCountry] = useState('PK');
  const [recipient, setRecipient] = useState({
    name: '',
    bankName: '',
    accountNumber: '',
    iban: '',
    branchCode: '',
    routingNumber: '',
    sortCode: '',
    accountType: 'checking',
    swift: '',
    bankAddress: '',
    city: '',
  });
  const [savedRecipients, setSavedRecipients] = useState([]);
  const [savedRecipientId, setSavedRecipientId] = useState(''); // '' means using inline form
  const [saveForFuture, setSaveForFuture] = useState(true);
  const [payrollMode, setPayrollMode] = useState(false);
  const [payrollItems, setPayrollItems] = useState([]);
  const [linkedPayrollItemId, setLinkedPayrollItemId] = useState(null);

  // Amount state
  const [amount, setAmount] = useState({
    source: 'USD',
    target: COUNTRIES.find((c) => c.code === country)?.currency || 'PKR',
    sourceAmount: '',
    targetAmount: '',
    rate: '',
    fee: '',
  });
  const [quote, setQuote] = useState(null);
  const [reference, setReference] = useState('');
  const [purpose, setPurpose] = useState('vendor');
  const [notes, setNotes] = useState('');

  // Workflow state
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [created, setCreated] = useState(null);

  // Auto-update target currency when country changes
  useEffect(() => {
    const c = COUNTRIES.find((x) => x.code === country);
    if (c) setAmount((a) => ({ ...a, target: c.currency }));
  }, [country]);

  // Load saved recipients (from Wise)
  useEffect(() => {
    api.get('/api/wise/recipients').then((r) => {
      const list = r.recipients?.content || r.recipients || [];
      setSavedRecipients(Array.isArray(list) ? list : []);
    }).catch(() => setSavedRecipients([]));
  }, []);

  // Load pending payroll items when payroll mode toggled on
  useEffect(() => {
    if (!payrollMode) return;
    api.get('/api/salary').then((r) => {
      const draft = (r.rows || []).find((d) => d.status === 'draft' || d.status === 'approved');
      if (!draft) { setPayrollItems([]); return; }
      api.get(`/api/salary/${draft.id}`).then((d) => {
        setPayrollItems((d.items || []).filter((it) => it.status !== 'paid' && it.is_active !== false));
      });
    });
  }, [payrollMode]);

  function pickPayrollItem(item) {
    setRecipient((r) => ({
      ...r,
      name: item.full_name || item.employee_name,
      bankName: item.bank_name || '',
      accountNumber: item.account_number || '',
    }));
    setLinkedPayrollItemId(item.id);
    setPurpose('salary');
    setReference(`Salary — ${item.employee_name}`);
    setAmount((a) => ({ ...a, sourceAmount: String(item.amount_usd || ''), source: 'USD' }));
    setPayrollMode(false);
  }

  async function getQuote() {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/api/wise/quote', {
        sourceCurrency: amount.source,
        targetCurrency: amount.target,
        sourceAmount: amount.sourceAmount ? parseFloat(amount.sourceAmount) : undefined,
        targetAmount: amount.targetAmount ? parseFloat(amount.targetAmount) : undefined,
      });
      setQuote(r);
      setAmount((a) => ({
        ...a,
        rate: r.rate,
        fee: r.paymentOption?.fee?.total ?? '',
        targetAmount: r.targetAmount || a.targetAmount,
        sourceAmount: r.sourceAmount || a.sourceAmount,
      }));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function createTransfer() {
    setBusy(true); setErr(null);
    try {
      let recipientId = savedRecipientId;

      if (channel === 'wise') {
        // If user filled inline form, create the recipient in Wise first.
        if (!recipientId) {
          const newRec = await createWiseRecipient({ country, recipient, currency: amount.target });
          recipientId = newRec.id;
          setSavedRecipientId(String(newRec.id));
        }
        if (!quote) { setErr('Please get a quote first'); setBusy(false); return; }

        const body = {
          quoteUuid: quote.id,
          recipientId,
          recipientName: recipient.name,
          recipientBank: recipient.bankName,
          recipientAccount: recipient.iban || recipient.accountNumber,
          recipientCountry: country,
          sourceCurrency: amount.source,
          targetCurrency: amount.target,
          sourceAmount: quote.sourceAmount,
          targetAmount: quote.targetAmount,
          exchangeRate: quote.rate,
          wiseFee: quote.paymentOption?.fee?.total,
          purpose, reference,
          payrollItemId: linkedPayrollItemId,
        };
        const r = await api.post('/api/wise/transfer', body);
        setCreated({ channel: 'wise', remittance: r.remittance });
      } else if (channel === 'manual') {
        const body = {
          recipientName: recipient.name,
          recipientBank: recipient.bankName,
          recipientAccount: recipient.iban || recipient.accountNumber,
          recipientCountry: country,
          sourceCurrency: amount.source,
          targetCurrency: amount.target,
          sourceAmount: parseFloat(amount.sourceAmount) || 0,
          targetAmount: parseFloat(amount.targetAmount) || parseFloat(amount.sourceAmount) || 0,
          exchangeRate: amount.rate ? parseFloat(amount.rate) : null,
          providerFee: amount.fee ? parseFloat(amount.fee) : null,
          providerReference: reference,
          purpose,
          reference: notes,
          payrollItemId: linkedPayrollItemId,
        };
        const r = await api.post('/api/wise/manual', body);
        setCreated({ channel: 'manual', remittance: r.remittance });
      }
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // Step → footer buttons
  const next = () => setStep((s) => Math.min(4, s + 1));
  const prev = () => setStep((s) => Math.max(1, s - 1));

  const canStep2 = !!channel;
  const canStep3 = recipient.name && (savedRecipientId || recipient.bankName);
  const canStep4 = amount.sourceAmount || amount.targetAmount;

  if (created) {
    return (
      <Modal open onClose={() => { onCreated(); }} title="Transfer created" wide
        footer={<Button onClick={() => onCreated()}>Done</Button>}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <CheckCircle2 size={56} color="var(--success)" style={{ marginBottom: 12 }} />
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>
            {created.channel === 'wise' ? 'Wise transfer created' : 'Manual wire recorded'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
            ID: <code>{created.remittance.id}</code>
          </p>
          {created.channel === 'wise' && (
            <Alert tone="warning" className="mt-4">
              ⚠ Transfer is created but NOT funded yet. A super admin must click "Fund" on the transfer row to actually deduct from the Wise balance.
            </Alert>
          )}
          {created.channel === 'manual' && (
            <Alert tone="info" className="mt-4">
              Upload your bank confirmation as proof in <a href="/approvals" style={{ color: 'var(--accent)' }}>Approvals</a> when ready.
            </Alert>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`New transfer — Step ${step} of 4`} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {step > 1 && <Button variant="secondary" onClick={prev}><ChevronLeft size={12} /> Back</Button>}
        {step === 1 && <Button onClick={next} disabled={!canStep2}>Next →</Button>}
        {step === 2 && <Button onClick={next} disabled={!canStep3}>Next →</Button>}
        {step === 3 && (channel === 'wise'
          ? <Button onClick={getQuote} disabled={busy || !canStep4}>{busy ? 'Quoting…' : (quote ? 'Re-quote' : 'Get quote')}</Button>
          : <Button onClick={next} disabled={!canStep4}>Next →</Button>)}
        {step === 3 && channel === 'wise' && quote && <Button onClick={next}>Next →</Button>}
        {step === 4 && (
          <Button variant="success" onClick={createTransfer} disabled={busy}>
            {busy ? 'Creating…' : (channel === 'wise' ? 'Create Transfer in Wise' : 'Record Transfer')}
          </Button>
        )}
      </>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}

      {/* Step 1 — Channel */}
      {step === 1 && (
        <div>
          <Label>Choose channel</Label>
          <div className="grid grid-cols-2 gap-3">
            {['wise', 'manual', 'swift', 'ach'].map((id) => {
              const cfg = CHANNEL_LABEL[id];
              const provider = providers.find((p) => p.id === id);
              const disabled = id === 'swift' || id === 'ach' || (!provider?.configured && id === 'wise');
              const subtitle = id === 'wise' ? (provider?.configured ? 'Best rates · auto API transfer' : 'Configure in Settings → Integrations')
                : id === 'manual' ? 'Records-only · upload proof later'
                : 'Coming soon';
              return (
                <button key={id} type="button" onClick={() => !disabled && setChannel(id)} disabled={disabled}
                  style={{
                    padding: 16, borderRadius: 12, textAlign: 'left',
                    border: `2px solid ${channel === id ? 'var(--accent)' : 'var(--border)'}`,
                    background: channel === id ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.55 : 1,
                  }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{cfg.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{cfg.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{subtitle}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2 — Recipient */}
      {step === 2 && (
        <div>
          {/* Saved recipients (Wise only) */}
          {channel === 'wise' && savedRecipients.length > 0 && (
            <div className="mb-3">
              <Label>Use saved recipient</Label>
              <Select value={savedRecipientId} onChange={(e) => setSavedRecipientId(e.target.value)}>
                <option value="">— Add new below —</option>
                {savedRecipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.accountHolderName || r.name} {r.currency ? `(${r.currency})` : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Payroll toggle */}
          <div className="mb-3">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={payrollMode} onChange={(e) => setPayrollMode(e.target.checked)} />
              Send salary payment (pull from payroll)
            </label>
            {payrollMode && (
              <Card className="p-3 mt-2" style={{ background: 'var(--bg-tertiary)' }}>
                {payrollItems.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No pending salary items. Approve a disbursement first.</div>}
                {payrollItems.map((it) => (
                  <button key={it.id} type="button" onClick={() => pickPayrollItem(it)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
                    <strong>{it.employee_name}</strong> {it.full_name && <span style={{ color: 'var(--text-tertiary)' }}>· {it.full_name}</span>}
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {it.bank_name || '—'} · {it.account_number || '—'} · {money(it.amount_usd, 'USD')}
                    </div>
                  </button>
                ))}
              </Card>
            )}
          </div>

          {/* Inline recipient form (only when not using saved) */}
          {!savedRecipientId && (
            <RecipientForm
              country={country}
              setCountry={setCountry}
              recipient={recipient}
              setRecipient={setRecipient}
              saveForFuture={saveForFuture}
              setSaveForFuture={setSaveForFuture}
              channel={channel}
            />
          )}
        </div>
      )}

      {/* Step 3 — Amount */}
      {step === 3 && (
        <div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>You send</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.01" value={amount.sourceAmount}
                  onChange={(e) => setAmount((a) => ({ ...a, sourceAmount: e.target.value, targetAmount: '' }))} />
                <Select value={amount.source} onChange={(e) => setAmount((a) => ({ ...a, source: e.target.value }))} style={{ maxWidth: 90 }}>
                  <option>USD</option><option>EUR</option><option>GBP</option>
                </Select>
              </div>
            </div>
            <div><Label>Recipient gets</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.01" value={amount.targetAmount}
                  onChange={(e) => setAmount((a) => ({ ...a, targetAmount: e.target.value, sourceAmount: channel === 'manual' ? a.sourceAmount : '' }))} />
                <Select value={amount.target} onChange={(e) => setAmount((a) => ({ ...a, target: e.target.value }))} style={{ maxWidth: 90 }}>
                  <option>PKR</option><option>USD</option><option>EUR</option><option>GBP</option><option>INR</option><option>PHP</option><option>BDT</option><option>AED</option>
                </Select>
              </div>
            </div>
          </div>

          {channel === 'wise' && quote && (
            <Card className="p-3 mt-3" style={{ background: 'var(--bg-tertiary)' }}>
              <Row label="Exchange rate" value={`${quote.rate} ${amount.target}/${amount.source}`} />
              <Row label="Wise fee" value={money(quote.paymentOption?.fee?.total || 0, amount.source)} />
              <Row label="You pay" value={money(quote.sourceAmount, amount.source)} bold />
              <Row label="Recipient gets" value={money(quote.targetAmount || 0, amount.target)} bold />
              {quote.paymentOption?.estimatedDelivery && (
                <Row label="Estimated arrival" value={new Date(quote.paymentOption.estimatedDelivery).toLocaleDateString()} />
              )}
            </Card>
          )}

          {channel === 'manual' && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div><Label>Exchange rate (manual)</Label>
                <Input type="number" step="0.000001" value={amount.rate}
                  onChange={(e) => setAmount((a) => ({ ...a, rate: e.target.value }))} />
              </div>
              <div><Label>Bank fee</Label>
                <Input type="number" step="0.01" value={amount.fee}
                  onChange={(e) => setAmount((a) => ({ ...a, fee: e.target.value }))} />
              </div>
              <div className="col-span-2"><Label>Bank wire reference</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="WIRE12345" />
              </div>
              <div className="col-span-2"><Label>Notes</Label>
                <Textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 4 — Review */}
      {step === 4 && (
        <div>
          <Card className="p-4" style={{ background: 'var(--bg-tertiary)' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>Review</div>
            <Row label="Channel" value={`${CHANNEL_LABEL[channel].icon} ${CHANNEL_LABEL[channel].label}`} />
            <Row label="Recipient" value={savedRecipientId ? (savedRecipients.find((r) => String(r.id) === String(savedRecipientId))?.accountHolderName || '(saved)') : recipient.name} />
            {recipient.bankName && <Row label="Bank" value={recipient.bankName} />}
            {(recipient.iban || recipient.accountNumber) && <Row label="Account" value={recipient.iban || recipient.accountNumber} />}
            <Row label="Country" value={COUNTRIES.find((c) => c.code === country)?.label || country} />
            <Row label="You send" value={money(channel === 'wise' ? quote?.sourceAmount : amount.sourceAmount, amount.source)} bold />
            <Row label="Recipient gets" value={money(channel === 'wise' ? quote?.targetAmount : amount.targetAmount, amount.target)} bold />
            {(amount.rate || quote?.rate) && <Row label="Rate" value={amount.rate || quote?.rate} />}
            {(amount.fee || quote?.paymentOption?.fee?.total) && <Row label="Fee" value={money(amount.fee || quote?.paymentOption?.fee?.total, amount.source)} />}
            <Row label="Purpose" value={purpose} />
            {reference && <Row label="Reference" value={reference} />}
            {linkedPayrollItemId && <Row label="Payroll item" value={`#${linkedPayrollItemId.slice(0, 8)} (will be marked paid on funding)`} />}
          </Card>

          {channel === 'wise' && (
            <Alert tone="warning" className="mt-3" icon={<AlertTriangle size={14} />}>
              ⚠ Creating the transfer does NOT send money. A super admin must click "Fund" on the transfer row to actually deduct from your Wise balance.
            </Alert>
          )}
          {channel === 'manual' && (
            <Alert tone="info" className="mt-3">
              This records the transfer in the ledger. No bank API is called. Upload your bank wire confirmation as proof in Approvals.
            </Alert>
          )}
        </div>
      )}
    </Modal>
  );
}

// ━━━ Country-aware recipient form ━━━
function RecipientForm({ country, setCountry, recipient, setRecipient, saveForFuture, setSaveForFuture, channel }) {
  const setF = (k, v) => setRecipient((r) => ({ ...r, [k]: v }));

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Recipient name *</Label>
          <Input value={recipient.name} onChange={(e) => setF('name', e.target.value)} />
        </div>
        <div><Label>Country *</Label>
          <Select value={country} onChange={(e) => setCountry(e.target.value)}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.currency})</option>)}
          </Select>
        </div>
      </div>

      {/* Country-specific fields */}
      {country === 'PK' && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="col-span-2"><Label>Pakistani bank *</Label>
            <Select value={recipient.bankName} onChange={(e) => {
              const bank = PK_BANKS.find((b) => b.name === e.target.value);
              setRecipient((r) => ({ ...r, bankName: e.target.value, swift: bank?.swift || r.swift }));
            }}>
              <option value="">— Select bank —</option>
              {PK_BANKS.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
            </Select>
          </div>
          <div><Label>Account IBAN <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'none', fontWeight: 400 }}>(PK + 22 digits)</span></Label>
            <Input placeholder="PK00…" value={recipient.iban} onChange={(e) => setF('iban', e.target.value.toUpperCase())} maxLength="24" />
          </div>
          <div><Label>OR Account number</Label>
            <Input value={recipient.accountNumber} onChange={(e) => setF('accountNumber', e.target.value)} />
          </div>
          <div><Label>Branch code</Label>
            <Input value={recipient.branchCode} onChange={(e) => setF('branchCode', e.target.value)} />
          </div>
          <div><Label>City</Label>
            <Input value={recipient.city} onChange={(e) => setF('city', e.target.value)} />
          </div>
        </div>
      )}

      {country === 'US' && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div><Label>Bank name</Label>
            <Input value={recipient.bankName} onChange={(e) => setF('bankName', e.target.value)} />
          </div>
          <div><Label>Account type</Label>
            <Select value={recipient.accountType} onChange={(e) => setF('accountType', e.target.value)}>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
            </Select>
          </div>
          <div><Label>Routing number (9 digits)</Label>
            <Input value={recipient.routingNumber} onChange={(e) => setF('routingNumber', e.target.value)} maxLength="9" />
          </div>
          <div><Label>Account number</Label>
            <Input value={recipient.accountNumber} onChange={(e) => setF('accountNumber', e.target.value)} />
          </div>
        </div>
      )}

      {country === 'GB' && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div><Label>Bank name</Label>
            <Input value={recipient.bankName} onChange={(e) => setF('bankName', e.target.value)} />
          </div>
          <div><Label>Sort code (XX-XX-XX)</Label>
            <Input placeholder="00-00-00" value={recipient.sortCode} onChange={(e) => setF('sortCode', e.target.value)} />
          </div>
          <div><Label>Account number (8 digits)</Label>
            <Input value={recipient.accountNumber} onChange={(e) => setF('accountNumber', e.target.value)} maxLength="8" />
          </div>
        </div>
      )}

      {!['PK', 'US', 'GB'].includes(country) && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div><Label>Bank name</Label>
            <Input value={recipient.bankName} onChange={(e) => setF('bankName', e.target.value)} />
          </div>
          <div><Label>SWIFT / BIC</Label>
            <Input value={recipient.swift} onChange={(e) => setF('swift', e.target.value.toUpperCase())} />
          </div>
          <div className="col-span-2"><Label>IBAN or account number</Label>
            <Input value={recipient.iban || recipient.accountNumber}
              onChange={(e) => setF(e.target.value.startsWith('PK') || e.target.value.startsWith('GB') || e.target.value.startsWith('AE') ? 'iban' : 'accountNumber', e.target.value)} />
          </div>
          <div className="col-span-2"><Label>Bank address</Label>
            <Input value={recipient.bankAddress} onChange={(e) => setF('bankAddress', e.target.value)} />
          </div>
        </div>
      )}

      {channel === 'wise' && (
        <div className="mt-3">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={saveForFuture} onChange={(e) => setSaveForFuture(e.target.checked)} />
            Save recipient in Wise for future transfers
          </label>
        </div>
      )}
    </div>
  );
}

// Helper: build the right Wise createRecipient body shape per country.
async function createWiseRecipient({ country, recipient, currency }) {
  let body;
  if (country === 'PK') {
    body = {
      currency: 'PKR',
      type: 'pakistan',
      profile: undefined, // backend fills
      accountHolderName: recipient.name,
      details: {
        legalType: 'PRIVATE',
        bankName: recipient.bankName,
        accountNumber: recipient.accountNumber || undefined,
        IBAN: recipient.iban || undefined,
        branchCode: recipient.branchCode || undefined,
        address: { city: recipient.city || 'Karachi', country: 'PK' },
      },
    };
  } else if (country === 'US') {
    body = {
      currency: 'USD',
      type: 'aba',
      accountHolderName: recipient.name,
      details: {
        legalType: 'PRIVATE',
        abartn: recipient.routingNumber,
        accountNumber: recipient.accountNumber,
        accountType: (recipient.accountType || 'checking').toUpperCase(),
        address: { country: 'US' },
      },
    };
  } else if (country === 'GB') {
    body = {
      currency: 'GBP',
      type: 'sort_code',
      accountHolderName: recipient.name,
      details: {
        legalType: 'PRIVATE',
        sortCode: recipient.sortCode,
        accountNumber: recipient.accountNumber,
      },
    };
  } else {
    body = {
      currency,
      type: 'iban',
      accountHolderName: recipient.name,
      details: {
        legalType: 'PRIVATE',
        IBAN: recipient.iban || recipient.accountNumber,
        BIC: recipient.swift || undefined,
        bankName: recipient.bankName,
        bankAddress: recipient.bankAddress,
      },
    };
  }
  return await api.post('/api/wise/recipients', body);
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: bold ? 600 : 400 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{value}</span>
    </div>
  );
}
