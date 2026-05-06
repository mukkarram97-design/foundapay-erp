import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, Download } from 'lucide-react';
import { useAuth } from '../store/auth';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, Logo, Badge, Alert, Modal,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import ThemeToggle from '../components/ui/ThemeToggle';
import { toast } from '../store/toast';
import { downloadReceipt, downloadStatement } from '../utils/downloadReceipt';

const BASE_TABS = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'payment_links', label: 'Payment Links' },
  { id: 'reserves',     label: 'Reserves' },
  { id: 'payouts',      label: 'Payouts' },
  { id: 'chargebacks',  label: 'Chargebacks' },
  { id: 'statement',    label: 'Statement' },
];

export default function ClientPortal() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [terminalAccess, setTerminalAccess] = useState(null); // null = not loaded, false = no access, object = access record
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('transactions');
  const [requestOpen, setRequestOpen] = useState(false);

  // Show Terminal tab only if the client has access enabled.
  const TABS = terminalAccess
    ? [...BASE_TABS, { id: 'terminal', label: '⚡ Terminal' }]
    : BASE_TABS;

  async function load() {
    try { setData(await api.get('/api/portal/me')); }
    catch (e) { setErr(e.message); }
    // Probe terminal access — soft check; if endpoint 403s/404s, hide the tab.
    try {
      const ta = await api.get('/api/portal/terminal-access');
      setTerminalAccess(ta?.access || false);
    } catch { setTerminalAccess(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <header className="border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo size={28} />
          <div className="flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Welcome, <span style={{ color: 'var(--text-primary)' }}>{user?.name || user?.email}</span>
            </span>
            <ThemeToggle />
            <Button variant="ghost" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>Sign out</Button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {err && <Alert tone="error">{err}</Alert>}
        {!data && !err && <Card className="p-8" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>}

        {data && (
          <>
            {/* Header */}
            <div className="flex items-end justify-between mb-6">
              <div>
                <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{data.client.name}</h1>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {data.client.company_name || data.client.country} · {data.client.status}
                </p>
              </div>
              <Button onClick={() => setRequestOpen(true)}>
                <Plus size={14} /> Request payment link
              </Button>
            </div>

            {/* Top stats */}
            {data.client.balance_owed != null && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                <Card className="fp-kpi" style={{ borderLeftColor: parseFloat(data.client.balance_owed) < 0 ? 'var(--danger)' : 'var(--success)' }}>
                  <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>Current balance</div>
                  <div className="text-3xl font-semibold mt-1" style={{ color: parseFloat(data.client.balance_owed) < 0 ? 'var(--danger)' : 'var(--success)' }}>
                    {money(data.client.balance_owed)}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    {parseFloat(data.client.balance_owed) < 0 ? 'You owe FoundaPay' : 'FoundaPay owes you'}
                  </div>
                </Card>
                <Card className="p-5">
                  <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>Opening balance</div>
                  <div className="text-2xl font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{money(data.client.opening_balance)}</div>
                </Card>
                <Card className="p-5">
                  <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>Reserves held</div>
                  <div className="text-2xl font-semibold mt-1" style={{ color: 'var(--info)' }}>
                    {money(data.reserves.reduce((a, r) => a + (parseFloat(r.amount) - parseFloat(r.released_amount || 0)), 0))}
                  </div>
                </Card>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 mb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 500,
                    color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
                    borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
                    background: 'transparent',
                    cursor: 'pointer',
                    marginBottom: -1,
                  }}
                >{t.label}</button>
              ))}
            </div>

            {tab === 'transactions' && (
              <Card className="overflow-hidden">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Date</Th><Th>Type</Th>
                      {data.visibility.show_customer_name && <Th>Counterparty</Th>}
                      <Th>Method</Th>
                      {data.visibility.show_gross_amount && <Th className="text-right">Gross</Th>}
                      {data.visibility.show_commission && <Th className="text-right">Commission</Th>}
                      <Th className="text-right">Net</Th>
                      <Th>Status</Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {data.transactions.map((t) => (
                      <Tr key={t.id}>
                        <Td>{dateOnly(t.date_received)}</Td>
                        <Td><Badge tone={t.type === 'Received' ? 'success' : 'warning'}>{t.type}</Badge></Td>
                        {data.visibility.show_customer_name && <Td>{t.counterparty_name || '—'}</Td>}
                        <Td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.payment_method || '—'}</Td>
                        {data.visibility.show_gross_amount && <Td className="text-right font-mono">{money(t.gross_amount)}</Td>}
                        {data.visibility.show_commission && <Td className="text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{money(t.fee_amount)}</Td>}
                        <Td className="text-right font-mono">{money(t.net_amount)}</Td>
                        <Td><Badge tone={t.status === 'Completed' ? 'success' : t.status === 'Hold' ? 'warning' : 'neutral'}>{t.status}</Badge></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}

            {tab === 'payouts' && (
              <Card className="overflow-hidden">
                <Table>
                  <Thead><Tr><Th>Date</Th><Th>Method</Th><Th>Reference</Th><Th>Status</Th><Th className="text-right">Amount</Th></Tr></Thead>
                  <tbody>
                    {data.payouts.length === 0 && <Tr><Td colSpan="5" style={{ color: 'var(--text-secondary)' }}>No payouts yet</Td></Tr>}
                    {data.payouts.map((p) => (
                      <Tr key={p.id}>
                        <Td>{dateOnly(p.sent_at || p.created_at)}</Td>
                        <Td>{p.payout_method || '—'}</Td>
                        <Td className="font-mono text-xs">{p.reference_number || '—'}</Td>
                        <Td><Badge tone="info">{p.status}</Badge></Td>
                        <Td className="text-right font-mono">{money(p.amount, p.currency || 'USD')}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}

            {tab === 'reserves' && (
              <Card className="overflow-hidden">
                <Table>
                  <Thead><Tr><Th>Hold date</Th><Th>Release date</Th><Th>Status</Th><Th className="text-right">Amount</Th><Th className="text-right">Released</Th></Tr></Thead>
                  <tbody>
                    {data.reserves.length === 0 && <Tr><Td colSpan="5" style={{ color: 'var(--text-secondary)' }}>No reserves</Td></Tr>}
                    {data.reserves.map((r) => (
                      <Tr key={r.id}>
                        <Td>{dateOnly(r.hold_date)}</Td>
                        <Td>{dateOnly(r.release_date)}</Td>
                        <Td><Badge tone={r.status === 'released' ? 'success' : 'warning'}>{r.status}</Badge></Td>
                        <Td className="text-right font-mono">{money(r.amount)}</Td>
                        <Td className="text-right font-mono">{money(r.released_amount)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}

            {tab === 'cards' && (
              <div>
                {data.assigned_cards.length === 0 ? (
                  <Card className="p-6" style={{ color: 'var(--text-secondary)' }}>No cards assigned to you yet.</Card>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                      {data.assigned_cards.map((c) => (
                        <Card key={c.id} className="p-4">
                          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{c.nickname}</div>
                          <div className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>••{c.last4}</div>
                          <div className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>{c.bank_name} · {c.card_type}</div>
                        </Card>
                      ))}
                    </div>
                    <Card className="overflow-hidden">
                      <div className="px-5 pt-4 pb-2"><h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Recent card expenses</h3></div>
                      <Table>
                        <Thead><Tr><Th>Date</Th><Th>Vendor</Th><Th>Description</Th><Th className="text-right">Amount</Th></Tr></Thead>
                        <tbody>
                          {data.card_expenses.length === 0 && <Tr><Td colSpan="4" style={{ color: 'var(--text-secondary)' }}>No card expenses</Td></Tr>}
                          {data.card_expenses.map((ex) => (
                            <Tr key={ex.id}>
                              <Td>{dateOnly(ex.date)}</Td>
                              <Td>{ex.vendor || '—'}</Td>
                              <Td>{ex.description || '—'}</Td>
                              <Td className="text-right font-mono">{money(ex.amount)}</Td>
                            </Tr>
                          ))}
                        </tbody>
                      </Table>
                    </Card>
                  </>
                )}
              </div>
            )}

            {tab === 'payment_links' && (
              <Card className="p-6" style={{ color: 'var(--text-secondary)' }}>
                Click "Request payment link" above to submit a new request. Status updates appear in your transactions.
              </Card>
            )}

            {tab === 'chargebacks' && (
              <Card className="overflow-hidden">
                <Table>
                  <Thead><Tr><Th>Customer</Th><Th>Reason</Th><Th>Deadline</Th><Th>Status</Th><Th className="text-right">Amount</Th></Tr></Thead>
                  <tbody>
                    {data.chargebacks.length === 0 && <Tr><Td colSpan="5" style={{ color: 'var(--text-secondary)' }}>No chargebacks</Td></Tr>}
                    {data.chargebacks.map((cb) => (
                      <Tr key={cb.id}>
                        <Td>{cb.customer_name}</Td>
                        <Td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{cb.reason}</Td>
                        <Td>{dateOnly(cb.evidence_deadline)}</Td>
                        <Td><Badge tone={cb.status === 'won' ? 'success' : cb.status === 'lost' ? 'danger' : 'warning'}>{cb.status}</Badge></Td>
                        <Td className="text-right font-mono" style={{ color: 'var(--danger)' }}>{money(cb.amount)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}

            {tab === 'statement' && (
              <StatementTab clientId={data.client.id} clientName={data.client.name} />
            )}

            {tab === 'terminal' && terminalAccess && (
              <TerminalTab access={terminalAccess} clientName={data.client.name} />
            )}
          </>
        )}
      </div>

      {requestOpen && data && (
        <RequestLinkModal
          clientId={data.client.id}
          onClose={() => setRequestOpen(false)}
          onSaved={() => { setRequestOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function RequestLinkModal({ clientId, onClose, onSaved }) {
  const [form, setForm] = useState({ amount: '', currency: 'USD', payment_method: 'Debit/Credit Cards', customer_name: '', customer_email: '', description: '' });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      // Client_user can't access /api/payment-links — use a portal-scoped path?
      // For now we attempt the create; backend permission will gate it.
      await api.post('/api/payment-links', { ...form, amount: parseFloat(form.amount), client_id: clientId });
      toast.success('Payment link requested');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Request payment link"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy || !form.amount}>{busy ? 'Submitting…' : 'Submit'}</Button></>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
        <div><Label>Method</Label><Select value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}><option>Debit/Credit Cards</option><option>ACH</option><option>Wire Transfer</option><option>PayPal</option></Select></div>
        <div><Label>Customer name</Label><Input value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} /></div>
        <div><Label>Customer email</Label><Input type="email" value={form.customer_email} onChange={(e) => setForm((f) => ({ ...f, customer_email: e.target.value }))} /></div>
        <div className="col-span-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}

function StatementTab({ clientId, clientName }) {
  const [from, setFrom] = React.useState('2026-04-01');
  const [to, setTo] = React.useState('2026-04-30');
  const [preview, setPreview] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  async function loadPreview() {
    setBusy(true);
    try {
      const r = await api.get(`/api/clients/${clientId}/statement?from=${from}&to=${to}`);
      setPreview(r);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  React.useEffect(() => { loadPreview(); /* eslint-disable-next-line */ }, []);

  return (
    <Card className="p-5">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Statement preview</h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Choose a period and download a PDF statement.</p>
        </div>
        <div className="flex items-end gap-2">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button variant="secondary" onClick={loadPreview} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</Button>
          <Button onClick={() => downloadStatement(clientId, from, to)}>
            <Download size={14} /> Download PDF
          </Button>
        </div>
      </div>

      {preview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Gross received" value={money(preview.totals.gross_received)} />
            <Stat label="Commission" value={money(preview.totals.commission)} tone="success" />
            <Stat label="Reserve held" value={money(preview.totals.reserve_held)} tone="warning" />
            <Stat label="Paid out" value={money(preview.totals.paid_out)} />
          </div>
          <Table>
            <Thead><Tr><Th>Date</Th><Th>Type</Th><Th>Method</Th><Th className="text-right">Gross</Th><Th className="text-right">Net</Th><Th>Status</Th><Th></Th></Tr></Thead>
            <tbody>
              {preview.transactions.length === 0 && <Tr><Td colSpan="7" style={{ color: 'var(--text-secondary)' }}>No transactions in this period.</Td></Tr>}
              {preview.transactions.slice(0, 50).map((t) => (
                <Tr key={t.id}>
                  <Td>{dateOnly(t.date_received)}</Td>
                  <Td><Badge tone={t.type === 'Received' ? 'success' : 'warning'}>{t.type}</Badge></Td>
                  <Td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.payment_method || '—'}</Td>
                  <Td className="text-right font-mono">{money(t.gross_amount)}</Td>
                  <Td className="text-right font-mono">{money(t.net_amount)}</Td>
                  <Td><Badge>{t.status}</Badge></Td>
                  <Td>
                    <button
                      onClick={() => downloadReceipt(t.id)}
                      title="Receipt"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)' }}
                    ><FileText size={14} /></button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, tone = 'default' }) {
  const c = { default: 'var(--text-primary)', success: 'var(--success)', warning: 'var(--warning)' };
  return (
    <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2, color: c[tone] }}>{value}</div>
    </div>
  );
}

// ━━━ Terminal tab — simplified self-service link generator ━━━
function TerminalTab({ access, clientName }) {
  const [form, setForm] = React.useState({ amount: '', description: '', customer_email: '', expiry_minutes: 1440 });
  const [result, setResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  async function generate() {
    if (!form.amount || parseFloat(form.amount) <= 0) return toast.error('Enter a valid amount');
    setBusy(true); setResult(null);
    try {
      const r = await api.post('/api/vt/generate-link', {
        amount: parseFloat(form.amount),
        description: form.description,
        customer_email: form.customer_email || undefined,
        invoiceNumber: `INV-${Date.now()}`,
        expiry_minutes: parseInt(form.expiry_minutes, 10),
        method: 'self_hosted',
      });
      setResult(r);
      toast.success('Payment link generated');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  function copyUrl() {
    if (!result?.hostedUrl) return;
    navigator.clipboard.writeText(result.hostedUrl);
    toast.success('Link copied');
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <Card className="p-5">
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
            Generate Payment Link
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>Charge a customer for {clientName}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            <div>
              <Label>Amount (USD)</Label>
              <Input
                type="number" step="0.01" placeholder="100.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <Label>Customer email (optional, for receipt)</Label>
              <Input
                type="email" placeholder="customer@example.com"
                value={form.customer_email}
                onChange={(e) => setForm((f) => ({ ...f, customer_email: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Description</Label>
              <Input
                placeholder="Invoice #1234, March consulting, etc."
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <Label>Link expires</Label>
              <Select value={form.expiry_minutes} onChange={(e) => setForm((f) => ({ ...f, expiry_minutes: e.target.value }))}>
                <option value="60">1 hour</option>
                <option value="1440">24 hours</option>
                <option value="10080">7 days</option>
              </Select>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={generate} disabled={busy} size="lg">
              {busy ? 'Generating…' : `Generate link → $${form.amount || '0.00'}`}
            </Button>
          </div>
          {access.per_transaction_limit > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 12 }}>
              Per-transaction limit: ${parseFloat(access.per_transaction_limit).toFixed(2)}
              {access.daily_limit > 0 && ` · Daily limit: $${parseFloat(access.daily_limit).toFixed(2)}`}
            </div>
          )}
        </Card>

        {result?.success && (
          <Card className="p-5" style={{ borderLeft: '3px solid var(--success)' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Link generated</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 4, marginBottom: 12 }}>
              Send this URL to your customer
            </h3>
            {result.qrCode && (
              <div className="mb-3" style={{ display: 'flex', justifyContent: 'center' }}>
                <img src={result.qrCode} alt="QR" style={{ width: 180, height: 180, borderRadius: 10, border: '1px solid var(--border)' }} />
              </div>
            )}
            <div style={{
              padding: '8px 10px', borderRadius: 8, background: 'var(--bg-tertiary)',
              fontFamily: 'ui-monospace, monospace', fontSize: 11, wordBreak: 'break-all', marginBottom: 8,
            }}>{result.hostedUrl}</div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={copyUrl}>Copy link</Button>
              <Button variant="secondary" onClick={() => window.open(result.hostedUrl, '_blank')}>Open page</Button>
            </div>
          </Card>
        )}
      </div>

      <div>
        <Card className="p-5">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            How this works
          </div>
          <ol style={{ fontSize: 13, lineHeight: 1.6, marginTop: 8, paddingLeft: 18, color: 'var(--text-secondary)' }}>
            <li>Enter the amount and description</li>
            <li>Click "Generate link"</li>
            <li>Copy the URL or share the QR code with your customer</li>
            <li>Customer pays securely on FoundaPay's page</li>
            <li>Funds settle to {clientName} per your normal cycle</li>
          </ol>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 16, padding: 10, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            🔒 Card data is tokenized via Authorize.net Accept.js — never stored on FoundaPay or your servers.
          </div>
        </Card>
      </div>
    </div>
  );
}
