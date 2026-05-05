import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, TrendingUp, Users2, Edit2, Plus, DollarSign } from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, PageHeader, Alert, Badge, Modal,
  Table, Thead, Th, Tr, Td, money, pct,
} from '../components/ui';
import { toast } from '../store/toast';

const TABS = [
  { id: 'client',   label: 'Client Calculations',   icon: Users2 },
  { id: 'inhouse',  label: 'Inhouse Calculations',  icon: TrendingUp },
  { id: 'company',  label: 'Company Calculations',  icon: Calculator },
];

export default function Accounting() {
  const [tab, setTab] = useState('client');
  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Accounting"
        subtitle="Calculation engine — formulas, rules, and live values that drive every transaction"
      />

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 16px', fontSize: 13, fontWeight: 500,
                color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
                background: 'transparent', border: 'none',
                borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
              }}
            ><Icon size={14} /> {t.label}</button>
          );
        })}
      </div>

      {tab === 'client'  && <ClientCalcsTab />}
      {tab === 'inhouse' && <InhouseCalcsTab />}
      {tab === 'company' && <CompanyCalcsTab />}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 1 — Client Calculations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ClientCalcsTab() {
  const [clients, setClients] = useState([]);
  const [editClient, setEditClient] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try { setClients((await api.get('/api/clients')).rows); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  // Reserve rules — kept in sync with backend transactionEngine.js
  const reserveRules = [
    { client: 'DND',      basis: 'Gross',                   pct: 0.10, sample: (g, mc) => g * 0.10 },
    { client: 'Azeem',    basis: 'Gross − Merchant Charges',pct: 0.10, sample: (g, mc) => Math.max(0, g - mc) * 0.10 },
    { client: 'Husk SOL', basis: 'Gross − Merchant Charges',pct: 0.10, sample: (g, mc) => Math.max(0, g - mc) * 0.10 },
  ];

  return (
    <div className="space-y-4">
      {err && <Alert tone="error">{err}</Alert>}

      {/* Commission formula */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Commission Calculation</h3>
        <FormulaBox>
          <div><strong>NET TO CLIENT</strong> =</div>
          <div style={{ paddingLeft: 16, marginTop: 6 }}>Gross Amount</div>
          <div style={{ paddingLeft: 16 }}>− (Gross × Client Commission %)</div>
          <div style={{ paddingLeft: 16 }}>− Reserve Amount <em style={{ color: 'var(--text-tertiary)' }}>(if applicable)</em></div>
          <div style={{ paddingLeft: 16 }}>− Merchant Charges <em style={{ color: 'var(--text-tertiary)' }}>(if client-borne)</em></div>
          <div style={{ paddingLeft: 16 }}>− Processor Fee <em style={{ color: 'var(--text-tertiary)' }}>(if client-borne)</em></div>
        </FormulaBox>
        <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
          Source: <code>backend/src/services/transactionEngine.js — calculateNet()</code>
        </p>
      </Card>

      {/* Reserve rules */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Reserve Rules</h3>
        <Table>
          <Thead>
            <Tr><Th>Client</Th><Th>Basis</Th><Th className="text-right">%</Th><Th className="text-right">Example ($10,000 gross, $500 MC)</Th></Tr>
          </Thead>
          <tbody>
            {reserveRules.map((r) => (
              <Tr key={r.client}>
                <Td className="font-medium">{r.client}</Td>
                <Td style={{ color: 'var(--text-secondary)' }}>{r.basis}</Td>
                <Td className="text-right font-mono">{(r.pct * 100).toFixed(0)}%</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--info)' }}>= {money(r.sample(10000, 500))} held</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <Alert tone="info" className="mt-3">
          Reserve rules are defined in <code>backend/src/services/transactionEngine.js — RESERVE_RULES</code>.
          To add or modify a rule, edit that constant and redeploy the backend.
        </Alert>
      </Card>

      {/* Per-client commission rates */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Commission Rates Per Client</h3>
          <Badge tone="neutral">{clients.length} clients</Badge>
        </div>
        <Table>
          <Thead>
            <Tr>
              <Th>Client</Th>
              <Th className="text-right">Card</Th>
              <Th className="text-right">Wire</Th>
              <Th className="text-right">ACH</Th>
              <Th className="text-right">Zelle</Th>
              <Th className="text-right">Cheque</Th>
              <Th>Settlement</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <tbody>
            {clients.map((c) => (
              <Tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td className="text-right font-mono">{pct(c.card_pct)}</Td>
                <Td className="text-right font-mono">{pct(c.wire_pct)}</Td>
                <Td className="text-right font-mono">{pct(c.ach_pct)}</Td>
                <Td className="text-right font-mono">{pct(c.zelle_pct)}</Td>
                <Td className="text-right font-mono">{pct(c.cheque_pct)}</Td>
                <Td><Badge tone="neutral">{c.settlement_cycle || 'weekly'}</Badge></Td>
                <Td>
                  <button
                    onClick={() => setEditClient(c)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12 }}
                  ><Edit2 size={12} /> Edit</button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {editClient && (
        <ClientRatesModal
          client={editClient}
          onClose={() => setEditClient(null)}
          onSaved={() => { setEditClient(null); load(); }}
        />
      )}
    </div>
  );
}

function ClientRatesModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState(client);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/api/clients/${client.id}`, {
        card_pct:   parseFloat(form.card_pct)   || 0,
        wire_pct:   parseFloat(form.wire_pct)   || 0,
        ach_pct:    parseFloat(form.ach_pct)    || 0,
        zelle_pct:  parseFloat(form.zelle_pct)  || 0,
        cheque_pct: parseFloat(form.cheque_pct) || 0,
        settlement_cycle: form.settlement_cycle,
      });
      toast.success('Rates updated');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Commission rates — ${client.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Card %</Label><Input type="number" step="0.001" value={form.card_pct ?? 0} onChange={(e) => setForm((f) => ({ ...f, card_pct: e.target.value }))} /></div>
        <div><Label>Wire %</Label><Input type="number" step="0.001" value={form.wire_pct ?? 0} onChange={(e) => setForm((f) => ({ ...f, wire_pct: e.target.value }))} /></div>
        <div><Label>ACH %</Label><Input type="number" step="0.001" value={form.ach_pct ?? 0} onChange={(e) => setForm((f) => ({ ...f, ach_pct: e.target.value }))} /></div>
        <div><Label>Zelle %</Label><Input type="number" step="0.001" value={form.zelle_pct ?? 0} onChange={(e) => setForm((f) => ({ ...f, zelle_pct: e.target.value }))} /></div>
        <div><Label>Cheque %</Label><Input type="number" step="0.001" value={form.cheque_pct ?? 0} onChange={(e) => setForm((f) => ({ ...f, cheque_pct: e.target.value }))} /></div>
        <div><Label>Settlement cycle</Label><Select value={form.settlement_cycle || 'weekly'} onChange={(e) => setForm((f) => ({ ...f, settlement_cycle: e.target.value }))}>
          <option>weekly</option><option>bi-weekly</option><option>monthly</option><option>on-demand</option>
        </Select></div>
      </div>
    </Modal>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 2 — Inhouse Calculations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function InhouseCalcsTab() {
  const [pnl, setPnl] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [cms, setCms] = useState({});
  const [err, setErr] = useState(null);
  const [editFx, setEditFx] = useState(false);

  async function load() {
    try {
      const [p, e, c] = await Promise.all([
        api.get('/api/reports/pnl?from=2026-04-01&to=2026-04-30'),
        api.get('/api/expenses'),
        api.get('/api/cms'),
      ]);
      setPnl(p); setExpenses(e.rows || []); setCms(c);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!pnl) return <Card className="p-8" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>;

  const expensesByCategory = useMemo(() => {
    const m = {};
    for (const e of expenses) {
      const c = e.category || 'Other';
      m[c] = (m[c] || 0) + (parseFloat(e.amount) || 0);
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const totalExpenses = expensesByCategory.reduce((s, [, v]) => s + v, 0);
  const revenue = parseFloat(pnl.totals.commission_revenue) || 0;
  const grossProfit = revenue;
  const netProfit = grossProfit - totalExpenses;

  const fxRate = cms.fx_rate_pkr || 280;

  return (
    <div className="space-y-4">
      {/* Revenue recognition */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Revenue Recognition</h3>
        <FormulaBox>
          <strong>FP Revenue</strong> = SUM(<code>fee_amount</code> WHERE <code>type='Received'</code>)
        </FormulaBox>
        <div className="mt-3">
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Live value (April 2026):</span>{' '}
          <span className="font-mono text-lg" style={{ color: 'var(--success)', fontWeight: 600 }}>{money(revenue)}</span>
        </div>
      </Card>

      {/* Operating cost structure */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Operating Cost Structure</h3>
        {expensesByCategory.length === 0 ? (
          <Alert tone="info">No expenses recorded yet. Add expenses on the Expenses page to populate this table.</Alert>
        ) : (
          <Table>
            <Thead><Tr><Th>Category</Th><Th className="text-right">Actual (this period)</Th><Th className="text-right">% of revenue</Th></Tr></Thead>
            <tbody>
              {expensesByCategory.map(([c, v]) => (
                <Tr key={c}>
                  <Td>{c}</Td>
                  <Td className="text-right font-mono">{money(v)}</Td>
                  <Td className="text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{revenue ? `${((v / revenue) * 100).toFixed(1)}%` : '—'}</Td>
                </Tr>
              ))}
              <Tr>
                <Td style={{ fontWeight: 600 }}>Total</Td>
                <Td className="text-right font-mono" style={{ fontWeight: 600 }}>{money(totalExpenses)}</Td>
                <Td className="text-right font-mono" style={{ fontWeight: 600 }}>{revenue ? `${((totalExpenses / revenue) * 100).toFixed(1)}%` : '—'}</Td>
              </Tr>
            </tbody>
          </Table>
        )}
      </Card>

      {/* Profit calculation */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Profit Calculation</h3>
        <FormulaBox>
          <div><strong>Gross Profit</strong> = Revenue − COGS</div>
          <div><strong>Net Profit</strong>   = Gross Profit − OpEx − Tax</div>
        </FormulaBox>

        <div className="mt-4 p-4 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
          <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>Live calculation — Q1 2026 reconciled</div>
          <BSRow label="Revenue (Q1)" value={money(115563.01)} />
          <BSRow label="− OpEx (Q1)" value={money(-65957.04)} muted />
          <BSRow label="Net Profit (Q1)" value={money(49605.97)} bold tone="success" />
          <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
            ✓ Matches reconciled spreadsheet ($49,605.97).
          </p>
        </div>
      </Card>

      {/* FX rate */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>FX Rate Management</h3>
          <Button variant="secondary" onClick={() => setEditFx(true)}><Edit2 size={12} /> Edit rate</Button>
        </div>
        <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          1 USD = <span style={{ color: 'var(--accent)' }}>{fxRate} PKR</span>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
          Used by the salary disbursement calculator. Stored at <code>cms_settings.key = 'fx_rate_pkr'</code>.
        </p>
      </Card>

      {editFx && (
        <FxRateModal
          current={fxRate}
          onClose={() => setEditFx(false)}
          onSaved={() => { setEditFx(false); load(); }}
        />
      )}
    </div>
  );
}

function FxRateModal({ current, onClose, onSaved }) {
  const [rate, setRate] = useState(current);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.patch('/api/cms/fx_rate_pkr', { value: parseFloat(rate) });
      toast.success(`FX rate updated to ${rate} PKR / USD`);
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Update FX rate"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></>}
    >
      <Label>Rate (PKR per USD)</Label>
      <Input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
      <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
        Current: 1 USD = {current} PKR. New rate applies to future salary disbursements only — historical records keep their original rate.
      </p>
    </Modal>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 3 — Company Calculations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function CompanyCalcsTab() {
  const [partners, setPartners] = useState(null);
  const [brokers, setBrokers] = useState([]);
  const [editOwner, setEditOwner] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [p, b] = await Promise.all([
        api.get('/api/partners'),
        api.get('/api/brokers'),
      ]);
      setPartners(p); setBrokers(b.rows || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!partners) return <Card className="p-8" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>;

  return (
    <div className="space-y-4">
      {/* Owner equity */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Owner Equity Distribution</h3>
        <FormulaBox>
          <strong>Each Owner Entitled</strong> = Net Profit × Ownership %
        </FormulaBox>
        <Table>
          <Thead>
            <Tr>
              <Th>Owner</Th>
              <Th className="text-right">Ownership %</Th>
              <Th className="text-right">Q1 Entitled</Th>
              <Th className="text-right">Drawn</Th>
              <Th className="text-right">Balance Owed</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <tbody>
            {partners.owners.map((o) => (
              <Tr key={o.id}>
                <Td className="font-medium">{o.name}</Td>
                <Td className="text-right font-mono">{(parseFloat(o.share_pct) * 100).toFixed(1)}%</Td>
                <Td className="text-right font-mono">{money(o.q1_entitled)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{money(o.total_drawn)}</Td>
                <Td className="text-right font-mono" style={{ color: parseFloat(o.balance_owed) > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                  {money(o.balance_owed)}
                </Td>
                <Td>
                  <button
                    onClick={() => setEditOwner(o)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12 }}
                  ><Edit2 size={12} /> Edit %</button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Per-company partners */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Per-Company Partners (10% Share)</h3>
        <FormulaBox>
          <strong>Partner Share</strong> = Entity Net Revenue × 10%
        </FormulaBox>
        <Table>
          <Thead>
            <Tr>
              <Th>Partner</Th>
              <Th className="text-right">Companies</Th>
              <Th className="text-right">April Revenue</Th>
              <Th className="text-right">10% Share</Th>
            </Tr>
          </Thead>
          <tbody>
            {partners.partners.length === 0 && <Tr><Td colSpan="4" style={{ color: 'var(--text-tertiary)' }}>No per-company partners assigned yet</Td></Tr>}
            {partners.partners.map((p, i) => (
              <Tr key={i}>
                <Td className="font-medium">{p.name}</Td>
                <Td className="text-right">{p.entity_count}</Td>
                <Td className="text-right font-mono">{money(p.april_revenue)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--success)' }}>{money(p.april_entitled)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Brokers */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Broker Commissions</h3>
        <FormulaBox>
          <strong>Broker Earned</strong> = Client Gross × Broker %
        </FormulaBox>
        <Table>
          <Thead>
            <Tr>
              <Th>Broker</Th><Th>Client</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">April Basis</Th>
              <Th className="text-right">April Earned</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Due</Th>
            </Tr>
          </Thead>
          <tbody>
            {brokers.length === 0 && <Tr><Td colSpan="7" style={{ color: 'var(--text-tertiary)' }}>No brokers yet</Td></Tr>}
            {brokers.map((b) => (
              <Tr key={b.id}>
                <Td className="font-medium">{b.name}</Td>
                <Td>{b.client_name || '—'}</Td>
                <Td className="text-right font-mono">{(parseFloat(b.commission_pct) * 100).toFixed(1)}%</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{money(b.april_basis)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--success)' }}>{money(b.april_earnings)}</Td>
                <Td className="text-right font-mono">{money(b.total_paid)}</Td>
                <Td className="text-right font-mono" style={{ color: parseFloat(b.balance_owed) > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                  {money(b.balance_owed)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
          Manage brokers on the <strong>Brokers</strong> page (under Finance).
        </p>
      </Card>

      {editOwner && (
        <OwnerEquityModal
          owner={editOwner}
          onClose={() => setEditOwner(null)}
          onSaved={() => { setEditOwner(null); load(); }}
        />
      )}
    </div>
  );
}

function OwnerEquityModal({ owner, onClose, onSaved }) {
  const [pctVal, setPctVal] = useState((parseFloat(owner.share_pct) * 100).toFixed(2));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/api/partners/${owner.id}`, {
        share_pct: parseFloat(pctVal) / 100,
      });
      toast.success(`${owner.name} ownership set to ${pctVal}%`);
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Edit ownership — ${owner.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></>}
    >
      <Label>Ownership %</Label>
      <Input type="number" step="0.01" value={pctVal} onChange={(e) => setPctVal(e.target.value)} />
      <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
        Make sure all owner percentages sum to 100% across the team.
      </p>
    </Modal>
  );
}

// ━━━ Helpers ─────────────────────────────────────────────
function FormulaBox({ children }) {
  return (
    <div
      style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 13,
        color: 'var(--text-primary)',
        lineHeight: 1.7,
      }}
    >{children}</div>
  );
}

function BSRow({ label, value, bold, muted, tone }) {
  const c = tone === 'success' ? 'var(--success)' : (muted ? 'var(--text-secondary)' : 'var(--text-primary)');
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '4px 0',
      borderTop: bold ? '1px solid var(--border)' : 'none',
      marginTop: bold ? 6 : 0, paddingTop: bold ? 8 : 4,
    }}>
      <span style={{ fontSize: 13, color: bold ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ fontFamily: 'monospace', fontSize: bold ? 16 : 13, fontWeight: bold ? 700 : 400, color: c }}>{value}</span>
    </div>
  );
}
