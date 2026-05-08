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

// Each item lists which permission flag must be true for the tab to render
// (or null if the tab is always visible — Home, Profile, Statement).
const ALL_NAV_ITEMS = [
  { id: 'home',          label: 'Home',          icon: '🏠', permFlag: null },
  { id: 'transactions',  label: 'Transactions',  icon: '📊', permFlag: 'can_master_ledger' },
  { id: 'payment_links', label: 'Payment Links', icon: '🔗', permFlag: 'can_payment_links' },
  { id: 'invoices',      label: 'Invoices',      icon: '🧾', permFlag: 'can_invoices' },
  { id: 'reserves',      label: 'Reserves',      icon: '🔒', permFlag: 'can_reserves' },
  { id: 'payouts',       label: 'Payouts',       icon: '💸', permFlag: 'can_payouts' },
  { id: 'chargebacks',   label: 'Chargebacks',   icon: '⚠️', permFlag: 'can_chargebacks' },
  { id: 'statement',     label: 'Statement',     icon: '📄', permFlag: 'can_reports' },
  { id: 'terminal',      label: 'Terminal',      icon: '⚡', permFlag: 'can_virtual_terminal', requiresTerminalAccess: true },
  { id: 'profile',       label: 'Profile',       icon: '👤', permFlag: null },
];

export default function ClientPortal() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [terminalAccess, setTerminalAccess] = useState(null); // null = not loaded, false = no access, object = access record
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('home');
  const [requestOpen, setRequestOpen] = useState(false);
  const [perms, setPerms] = useState(null);
  const [usage, setUsage] = useState(null);

  // Build the sidebar nav: filter ALL_NAV_ITEMS by permission flags + terminal access probe.
  // If perms isn't loaded yet, allow every tab (avoids a blank sidebar on first paint).
  const NAV_ITEMS = ALL_NAV_ITEMS.filter((item) => {
    if (item.requiresTerminalAccess && !terminalAccess) return false;
    if (!item.permFlag) return true;
    if (!perms) return true; // perms still loading — show optimistically
    return !!perms[item.permFlag];
  });
  // Legacy alias kept so older inline code that references TABS still works.
  const TABS = NAV_ITEMS;

  async function load() {
    try { setData(await api.get('/api/portal/me')); }
    catch (e) { setErr(e.message); }
    // Probe terminal access — soft check; if endpoint 403s/404s, hide the tab.
    try {
      const ta = await api.get('/api/portal/terminal-access');
      setTerminalAccess(ta?.access || false);
    } catch { setTerminalAccess(false); }
    // Pull user-level permissions + usage for Home/Profile display.
    try {
      const p = await api.get('/api/permissions/me');
      setPerms(p?.permissions || null);
      setUsage(p?.usage || null);
    } catch { /* ignore — non-critical */ }
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

            {/* Sidebar + main layout (replaces top-tab strip) */}
            <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'minmax(180px, 220px) 1fr' }}>
              <aside style={{
                borderRight: '1px solid var(--border)',
                paddingRight: 12,
                position: 'sticky',
                top: 16,
                alignSelf: 'flex-start',
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', padding: '4px 8px 6px' }}>
                  My Portal
                </div>
                <nav className="flex flex-col gap-0.5">
                  {NAV_ITEMS.map((t) => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 8, border: 'none',
                        background: tab === t.id ? 'var(--accent-dim)' : 'transparent',
                        color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
                        fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        textAlign: 'left',
                      }}>
                      <span>{t.icon}</span>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </nav>
              </aside>

              <div className="min-w-0">
                {/* Tab content rendered below — we close this column at the end of the sections. */}

            {tab === 'home' && (
              <ClientHomeTab data={data} perms={perms} usage={usage}
                onQuickAction={(t) => setTab(t)} />
            )}

            {tab === 'profile' && (
              <ClientProfileTab user={user} data={data} perms={perms} terminalAccess={terminalAccess} />
            )}

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

            {tab === 'invoices' && (
              <ClientInvoicesTab data={data} />
            )}
              </div>{/* close right-column main */}
            </div>{/* close grid wrapper */}
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Home tab — welcome, stats, limit usage, quick actions, recent activity
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ClientHomeTab({ data, perms, usage, onQuickAction }) {
  const [brands, setBrands] = useState([]);
  useEffect(() => {
    if (!data?.client?.id) return;
    api.get(`/api/clients/${data.client.id}/brands`)
      .then((r) => setBrands(r.rows || []))
      .catch(() => setBrands([]));
  }, [data?.client?.id]);

  if (!data) return null;
  const txs = data.transactions || [];
  const links = data.payment_links || [];
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthlyReceived = txs
    .filter((t) => t.type === 'Received' && new Date(t.date_received) >= monthStart)
    .reduce((s, t) => s + (parseFloat(t.gross_amount) || 0), 0);
  const pendingLinks = links.filter((l) => !['paid', 'cancelled', 'failed', 'expired', 'refunded'].includes(l.status)).length;
  const balanceDue = parseFloat(data.balance?.current_balance) || 0;
  const showUsage = perms?.show_usage_to_user && usage;

  // Count payment_links this month per brand_id (when the link carries one).
  const brandLinkCounts = (() => {
    const m = {};
    for (const l of links) {
      if (!l.brand_id) continue;
      const created = new Date(l.created_at);
      if (created < monthStart) continue;
      m[l.brand_id] = (m[l.brand_id] || 0) + 1;
    }
    return m;
  })();

  // Quick-action visibility from perms (always show what's enabled in user_permissions)
  const showVT = perms?.can_virtual_terminal !== false; // default true on portal until configured
  const showLinks = perms?.can_payment_links !== false;
  const showPayouts = perms?.can_payouts !== false;
  const showStatement = perms?.can_reports !== false;

  return (
    <div>
      {/* Welcome */}
      <div className="mb-4" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
        Welcome back, {data.client?.name || 'there'}
      </div>
      <div className="mb-5" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
        {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card className="p-4">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Received this month</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{money(monthlyReceived)}</div>
        </Card>
        <Card className="p-4">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Pending payment links</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--warning)' }}>{pendingLinks}</div>
        </Card>
        <Card className="p-4">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Balance owed to you</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: balanceDue >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(balanceDue)}</div>
        </Card>
        <Card className="p-4">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Reserve held</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{money(data.balance?.reserve_held)}</div>
        </Card>
      </div>

      {/* My brands — one card per active brand with this-month link counts */}
      {brands.length > 0 && (
        <div className="mb-5">
          <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 12 }}>
            My brands
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {brands.map((b) => (
              <Card key={b.id} className="p-4" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{
                  width: 56, height: 56, flexShrink: 0,
                  borderRadius: 10, border: '1px solid var(--border)',
                  background: b.brand_color || 'var(--bg-tertiary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', color: 'white', fontWeight: 700, fontSize: 16,
                }}>
                  {b.logo_url
                    ? <img src={b.logo_url} alt={b.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : (b.name || '?').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                    {b.is_default && <span style={{ fontSize: 9, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 5px', borderRadius: 4, fontWeight: 600 }}>DEFAULT</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                    {brandLinkCounts[b.id] || 0} {brandLinkCounts[b.id] === 1 ? 'payment' : 'payments'} this month
                  </div>
                  <Button size="sm" onClick={() => {
                    sessionStorage.setItem('vt_default_brand_id', b.id);
                    onQuickAction('terminal');
                  }}>Generate Link →</Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Limit usage */}
      {showUsage && (
        <Card className="p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
              My limits
            </h3>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Period {usage.period?.start} → {usage.period?.end}
            </span>
          </div>
          <UsageBar
            label="Monthly"
            used={usage.charged?.this_period}
            cap={parseFloat(perms?.vt_limit_monthly) || 0}
          />
          <UsageBar
            label="Daily"
            used={usage.charged?.today}
            cap={parseFloat(perms?.vt_limit_daily) || 0}
          />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
            Links: <strong>{usage.links?.this_period ?? 0}</strong> this period · <strong>{usage.links?.today ?? 0}</strong> today
            {parseFloat(perms?.vt_max_links_per_month) > 0 && ` · ${perms.vt_max_links_per_month}/month max`}
          </div>
        </Card>
      )}

      {/* Quick actions */}
      <Card className="p-5 mb-5">
        <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Quick actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {showLinks && (
            <Button onClick={() => onQuickAction('terminal')}>💳 New Payment Link</Button>
          )}
          {showStatement && (
            <Button variant="secondary" onClick={() => onQuickAction('statement')}>📄 Download Statement</Button>
          )}
          {showPayouts && (
            <Button variant="secondary" onClick={() => onQuickAction('payouts')}>💰 Request Payout</Button>
          )}
          <Button variant="secondary" onClick={() => onQuickAction('transactions')}>📊 View Transactions</Button>
        </div>
      </Card>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div style={{ padding: '14px 16px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>
            Recent transactions
          </div>
          <Table>
            <Thead><Tr><Th>Date</Th><Th>Type</Th><Th className="text-right">Amount</Th><Th>Status</Th></Tr></Thead>
            <tbody>
              {txs.slice(0, 5).map((t) => (
                <Tr key={t.id}>
                  <Td className="text-xs">{dateOnly(t.date_received)}</Td>
                  <Td><Badge tone={t.type === 'Received' ? 'success' : 'warning'}>{t.type}</Badge></Td>
                  <Td className="text-right font-mono">{money(t.gross_amount)}</Td>
                  <Td><Badge tone={t.status === 'Completed' ? 'success' : 'neutral'}>{t.status}</Badge></Td>
                </Tr>
              ))}
              {txs.length === 0 && <Tr><Td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 16 }}>No transactions yet.</Td></Tr>}
            </tbody>
          </Table>
        </Card>

        <Card>
          <div style={{ padding: '14px 16px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>
            Recent payment links
          </div>
          <Table>
            <Thead><Tr><Th>Created</Th><Th>Customer</Th><Th className="text-right">Amount</Th><Th>Status</Th></Tr></Thead>
            <tbody>
              {links.slice(0, 5).map((l) => (
                <Tr key={l.id}>
                  <Td className="text-xs">{dateOnly(l.created_at)}</Td>
                  <Td className="text-xs">{l.customer_name || l.customer_email || '—'}</Td>
                  <Td className="text-right font-mono">{money(l.amount)}</Td>
                  <Td><Badge tone={l.status === 'paid' ? 'success' : 'warning'}>{l.status}</Badge></Td>
                </Tr>
              ))}
              {links.length === 0 && <Tr><Td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 16 }}>No payment links yet.</Td></Tr>}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

function UsageBar({ label, used, cap }) {
  const u = parseFloat(used) || 0;
  const c = parseFloat(cap) || 0;
  const pct = c > 0 ? Math.min(100, Math.round((u / c) * 100)) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label} limit</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)' }}>
          {money(u)} / {c > 0 ? money(c) : '∞'} {c > 0 && `(${pct}%)`}
        </span>
      </div>
      {c > 0 && (
        <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 999, marginTop: 4, overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--accent)',
            transition: 'width 200ms',
          }} />
        </div>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Profile tab — identity + assigned merchants + limits (read-only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ClientProfileTab({ user, data, perms, terminalAccess }) {
  const cap = (n) => n > 0 ? money(n) : 'Unlimited';
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-5">
        <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.06em', marginBottom: 12 }}>
          Identity
        </h3>
        <ProfileRow label="Name" value={user?.name || '—'} />
        <ProfileRow label="Email" value={user?.email} mono />
        <ProfileRow label="Role" value={user?.role} />
        <ProfileRow label="Client" value={data?.client?.name || '—'} />
        {data?.client?.country && <ProfileRow label="Country" value={data.client.country} />}
      </Card>

      <Card className="p-5">
        <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.06em', marginBottom: 12 }}>
          Module access
        </h3>
        {perms ? (
          <div style={{ fontSize: 13 }}>
            <ProfileToggle label="Virtual Terminal" on={perms.can_virtual_terminal} />
            <ProfileToggle label="Payment Links" on={perms.can_payment_links} />
            <ProfileToggle label="Invoices" on={perms.can_invoices} />
            <ProfileToggle label="Transactions" on={perms.can_master_ledger} />
            <ProfileToggle label="Reports" on={perms.can_reports} />
            <ProfileToggle label="Payouts" on={perms.can_payouts} />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            No custom permissions configured. Defaults apply.
          </div>
        )}
      </Card>

      {perms && (
        <Card className="p-5 lg:col-span-2">
          <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.06em', marginBottom: 12 }}>
            My limits
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <ProfileStat label="Per transaction" value={cap(parseFloat(perms.vt_limit_per_transaction))} />
            <ProfileStat label="Daily total" value={cap(parseFloat(perms.vt_limit_daily))} />
            <ProfileStat label="Monthly total" value={cap(parseFloat(perms.vt_limit_monthly))} />
            <ProfileStat label="Max link amount" value={cap(parseFloat(perms.vt_link_max_amount))} />
            <ProfileStat label="Links / day"
              value={parseFloat(perms.vt_max_links_per_day) > 0 ? perms.vt_max_links_per_day : 'Unlimited'} />
            <ProfileStat label="Links / month"
              value={parseFloat(perms.vt_max_links_per_month) > 0 ? perms.vt_max_links_per_month : 'Unlimited'} />
            <ProfileStat label="Link expires after" value={`${perms.vt_link_auto_expire_hours || 24} h`} />
            <ProfileStat label="When limit hit" value={({ block: 'Block', warn: 'Warn', require_approval: 'Approval' })[perms.limit_action] || 'Block'} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 12 }}>
            These limits are read-only. Contact your account manager to change them.
          </div>
        </Card>
      )}
    </div>
  );
}

function ProfileRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
function ProfileToggle({ label, on }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color: on ? 'var(--success)' : 'var(--text-tertiary)' }}>
        {on ? '✓ Enabled' : '— Disabled'}
      </span>
    </div>
  );
}
function ProfileStat({ label, value }) {
  return (
    <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Client-scoped Invoices tab — read-only list of THIS client's invoices.
// (Reuses the data already fetched in /api/portal/me.)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ClientInvoicesTab({ data }) {
  const invoices = data?.invoices || [];
  const totals = invoices.reduce((acc, inv) => {
    acc.total += parseFloat(inv.total_amount) || 0;
    if (inv.status === 'paid') acc.paid += parseFloat(inv.total_amount) || 0;
    if (['sent', 'viewed', 'overdue'].includes(inv.status)) acc.outstanding += parseFloat(inv.total_amount) || 0;
    return acc;
  }, { total: 0, paid: 0, outstanding: 0 });
  const STATUS_TONE = {
    draft: 'neutral', sent: 'info', viewed: 'info',
    paid: 'success', overdue: 'warning', cancelled: 'danger',
  };

  function downloadPdf(inv) {
    const token = localStorage.getItem('foundapay_token');
    fetch(`/api/invoices/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.blob() : Promise.reject(new Error('PDF download failed')))
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${inv.invoice_number}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })
      .catch((e) => toast.error(e.message));
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card className="p-4">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Invoices</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{invoices.length}</div>
        </Card>
        <Card className="p-4">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Paid</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--success)' }}>{money(totals.paid)}</div>
        </Card>
        <Card className="p-4">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Outstanding</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--warning)' }}>{money(totals.outstanding)}</div>
        </Card>
      </div>

      <Card>
        <Table>
          <Thead>
            <Tr>
              <Th>Invoice #</Th>
              <Th>Issued</Th>
              <Th>Due</Th>
              <Th>Customer</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <tbody>
            {invoices.length === 0 && (
              <Tr>
                <Td colSpan="7" style={{ textAlign: 'center', padding: 28, color: 'var(--text-tertiary)' }}>
                  No invoices yet.
                </Td>
              </Tr>
            )}
            {invoices.map((inv) => (
              <Tr key={inv.id}>
                <Td className="font-mono text-xs">{inv.invoice_number}</Td>
                <Td className="text-xs">{dateOnly(inv.issue_date)}</Td>
                <Td className="text-xs">{inv.due_date ? dateOnly(inv.due_date) : '—'}</Td>
                <Td>
                  <div style={{ fontSize: 12 }}>{inv.customer_name || '—'}</div>
                  {inv.customer_email && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{inv.customer_email}</div>}
                </Td>
                <Td className="text-right font-mono">{money(inv.total_amount)}</Td>
                <Td><Badge tone={STATUS_TONE[inv.status] || 'neutral'}>{inv.status}</Badge></Td>
                <Td>
                  <Button size="sm" variant="secondary" onClick={() => downloadPdf(inv)}>
                    <Download size={12} /> PDF
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
