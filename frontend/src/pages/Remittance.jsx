import React, { useEffect, useState } from 'react';
import {
  Send, RefreshCw, Eye, AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Textarea, Label, PageHeader, Modal, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';

const STATUS_DISPLAY = {
  draft:             { label: 'Draft', tone: 'neutral' },
  quote_created:     { label: 'Quoted', tone: 'info' },
  transfer_created:  { label: 'Transfer created', tone: 'info' },
  processing:        { label: 'Processing', tone: 'info' },
  sent:              { label: 'Sent', tone: 'accent' },
  completed:         { label: 'Completed ✅', tone: 'success' },
  failed:            { label: 'Failed ❌', tone: 'danger' },
  cancelled:         { label: 'Cancelled', tone: 'neutral' },
};

export default function Remittance() {
  const { user: me } = useAuth();
  const isSuper = ['super_admin', 'owner'].includes(me?.role);

  const [balances, setBalances] = useState(null);
  const [balancesErr, setBalancesErr] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openSend, setOpenSend] = useState(false);

  async function loadBalances() {
    setBalancesErr(null);
    try {
      const r = await api.get('/api/wise/balances');
      setBalances(r.balances || []);
    } catch (e) { setBalancesErr(e.message); }
  }
  async function loadRows() {
    setLoading(true);
    try {
      const r = await api.get('/api/wise');
      setRows(r.rows);
    } finally { setLoading(false); }
  }
  useEffect(() => { loadBalances(); loadRows(); }, []);

  async function syncAll() {
    try {
      const r = await api.post('/api/wise/sync', {});
      toast.success(`Synced ${r.updated} transfers`);
      loadRows();
    } catch (e) { toast.error(e.message); }
  }

  async function fundOne(row) {
    if (!isSuper) return;
    if (!window.confirm(`Fund $${row.source_amount} ${row.source_currency} to ${row.recipient_name}? This deducts from your Wise balance.`)) return;
    try {
      await api.post(`/api/wise/transfer/${row.id}/fund`, {});
      toast.success('Funded');
      loadRows();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Remittance 💸"
        subtitle="Wise transfers — Nextgenase Inc"
        actions={isSuper && <Button onClick={() => setOpenSend(true)}><Send size={14} /> Send money</Button>}
      />

      {/* Balances */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
            Wise balances
          </div>
          <Button variant="ghost" size="sm" onClick={loadBalances}><RefreshCw size={12} /> Refresh</Button>
        </div>
        {balancesErr && <Alert tone="error" className="mb-2">{balancesErr}</Alert>}
        {!balances && !balancesErr && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading…</div>}
        {balances && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {balances.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No balances yet.</div>}
            {balances.map((b, i) => (
              <Card key={i} className="p-3" style={{ background: 'var(--bg-tertiary)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{b.currency || '—'}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {money(b.amount?.value ?? b.amount, b.currency || 'USD')}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>

      {/* Transfer history */}
      <Card>
        <div className="flex items-center justify-between" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
            Transfer history ({rows.length})
          </div>
          <Button variant="secondary" size="sm" onClick={syncAll}><RefreshCw size={12} /> Sync from Wise</Button>
        </div>
        <Table>
          <Thead>
            <Tr>
              <Th>Date</Th>
              <Th>Recipient</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th className="text-right">Source</Th>
              <Th className="text-right">Target</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Fee</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <tbody>
            {loading && <Tr><Td colSpan="10" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</Td></Tr>}
            {!loading && rows.length === 0 && (
              <Tr><Td colSpan="10" style={{ textAlign: 'center', padding: 28, color: 'var(--text-secondary)' }}>
                No remittances yet. {isSuper && <button onClick={() => setOpenSend(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>Send your first transfer →</button>}
              </Td></Tr>
            )}
            {!loading && rows.map((r) => {
              const sd = STATUS_DISPLAY[r.status] || { label: r.status, tone: 'neutral' };
              return (
                <Tr key={r.id}>
                  <Td className="text-xs">{dateOnly(r.created_at)}</Td>
                  <Td>
                    <div style={{ fontSize: 12 }}>{r.recipient_name || '—'}</div>
                    {r.recipient_account && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{r.recipient_account}</div>}
                  </Td>
                  <Td className="text-xs">{r.source_currency}</Td>
                  <Td className="text-xs">{r.target_currency}</Td>
                  <Td className="text-right font-mono">{money(r.source_amount, r.source_currency)}</Td>
                  <Td className="text-right font-mono">{money(r.target_amount, r.target_currency)}</Td>
                  <Td className="text-right font-mono">{r.exchange_rate ? Number(r.exchange_rate).toFixed(4) : '—'}</Td>
                  <Td className="text-right font-mono">{r.wise_fee != null ? money(r.wise_fee, r.source_currency) : '—'}</Td>
                  <Td><Badge tone={sd.tone}>{sd.label}</Badge></Td>
                  <Td>
                    <div className="flex gap-1 flex-wrap">
                      {r.status === 'transfer_created' && isSuper && (
                        <Button size="sm" variant="success" onClick={() => fundOne(r)}>Fund</Button>
                      )}
                      {r.wise_transfer_id && (
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

      {openSend && (
        <SendMoneyModal
          onClose={() => setOpenSend(false)}
          onSent={() => { setOpenSend(false); loadRows(); loadBalances(); }}
        />
      )}
    </div>
  );
}

// ━━━ Send money modal ━━━
function SendMoneyModal({ onClose, onSent }) {
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState({ source: 'USD', target: 'PKR', sourceAmount: '', targetAmount: '' });
  const [quote, setQuote] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [recipientId, setRecipientId] = useState('');
  const [purpose, setPurpose] = useState('salary');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/api/wise/recipients').then((r) => setRecipients(r.recipients || [])).catch(() => {});
  }, []);

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
      setStep(2);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function createTransfer() {
    setBusy(true); setErr(null);
    try {
      const recip = recipients.find((x) => String(x.id) === String(recipientId));
      const body = {
        quoteUuid: quote?.id,
        recipientId,
        recipientName: recip?.accountHolderName || recip?.name,
        recipientBank: recip?.details?.bankName || recip?.legalEntityType,
        recipientAccount: recip?.details?.accountNumber || recip?.details?.iban || '',
        recipientCountry: recip?.details?.country || null,
        sourceCurrency: amount.source,
        targetCurrency: amount.target,
        sourceAmount: quote?.sourceAmount,
        targetAmount: quote?.targetAmount,
        exchangeRate: quote?.rate,
        wiseFee: quote?.paymentOption?.fee?.total,
        purpose, reference,
      };
      const r = await api.post('/api/wise/transfer', body);
      toast.success(`Transfer created (Wise #${r.remittance.wise_transfer_id}). Super admin must fund.`);
      onSent();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const canQuote = (amount.sourceAmount || amount.targetAmount) && amount.source && amount.target;

  return (
    <Modal open onClose={onClose} title={`Send money — Step ${step} of 3`} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {step === 1 && <Button onClick={getQuote} disabled={busy || !canQuote}>{busy ? 'Quoting…' : 'Get quote'}</Button>}
        {step === 2 && <Button onClick={() => setStep(3)} disabled={!recipientId}>Next →</Button>}
        {step === 3 && <Button onClick={createTransfer} disabled={busy} variant="success">{busy ? 'Creating…' : 'Confirm & create transfer'}</Button>}
      </>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}

      {step === 1 && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><Label>You send</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.01" placeholder="0.00"
                  value={amount.sourceAmount}
                  onChange={(e) => setAmount((a) => ({ ...a, sourceAmount: e.target.value, targetAmount: '' }))} />
                <Select value={amount.source} onChange={(e) => setAmount((a) => ({ ...a, source: e.target.value }))} style={{ maxWidth: 90 }}>
                  <option>USD</option><option>EUR</option><option>GBP</option>
                </Select>
              </div>
            </div>
            <div><Label>Recipient gets (auto from rate)</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.01" placeholder="0.00"
                  value={amount.targetAmount}
                  onChange={(e) => setAmount((a) => ({ ...a, targetAmount: e.target.value, sourceAmount: '' }))} />
                <Select value={amount.target} onChange={(e) => setAmount((a) => ({ ...a, target: e.target.value }))} style={{ maxWidth: 90 }}>
                  <option>PKR</option><option>USD</option><option>EUR</option><option>INR</option><option>PHP</option><option>GBP</option>
                </Select>
              </div>
            </div>
          </div>
          {quote && (
            <Card className="p-3" style={{ background: 'var(--bg-tertiary)' }}>
              <Row label="Exchange rate" value={`${quote.rate} ${amount.target}/${amount.source}`} />
              <Row label="Wise fee" value={money(quote.paymentOption?.fee?.total || 0, amount.source)} />
              <Row label="You pay" value={money(quote.sourceAmount, amount.source)} bold />
              <Row label="Recipient gets" value={money(quote.targetAmount, amount.target)} bold />
            </Card>
          )}
        </div>
      )}

      {step === 2 && (
        <div>
          <Label>Select recipient</Label>
          <Select value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
            <option value="">— Choose —</option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.accountHolderName || r.name} {r.currency ? `(${r.currency})` : ''}
              </option>
            ))}
          </Select>
          {recipients.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
              No saved recipients. Add one in Wise dashboard, then refresh.
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Purpose</Label>
              <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option value="salary">Salary</option>
                <option value="vendor">Vendor payment</option>
                <option value="client_payout">Client payout</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div><Label>Reference (recipient sees this)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Salary March 2026" />
            </div>
          </div>
          <Card className="p-3 mt-3" style={{ background: 'var(--bg-tertiary)' }}>
            <Row label="From" value={`${amount.source} ${money(quote?.sourceAmount, amount.source)}`} />
            <Row label="To" value={`${amount.target} ${money(quote?.targetAmount, amount.target)}`} />
            <Row label="Rate" value={quote?.rate} />
            <Row label="Fee" value={money(quote?.paymentOption?.fee?.total || 0, amount.source)} />
            <Row label="Recipient" value={recipients.find((r) => String(r.id) === String(recipientId))?.accountHolderName || '—'} />
          </Card>
          <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'var(--warning-bg)', color: 'var(--warning-fg)', fontSize: 12 }}>
            ⚠ Creating the transfer does NOT send money. A super admin must click "Fund" on the transfer row to deduct from the Wise balance.
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: bold ? 600 : 400 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{value}</span>
    </div>
  );
}
