import React, { useEffect, useState } from 'react';
import { Edit2, Trash2, ExternalLink, Save, FileText } from 'lucide-react';
import { api } from '../../utils/api';
import SlideOver from './SlideOver';
import { Badge, Button, Input, Select, Label, Textarea, money, dateOnly } from './index';
import { toast } from '../../store/toast';
import { useAuth } from '../../store/auth';
import { downloadReceipt } from '../../utils/downloadReceipt';

const STATUS_TONE = { Completed: 'green', Hold: 'amber', Processing: 'blue', 'Charge Back': 'red' };

export default function TransactionDetail({ tx, onClose, onSaved, onDeleted, clients = [], entities = [] }) {
  const { user } = useAuth();
  // Initialize form synchronously so it's never null on first render —
  // this fixes the Rules-of-Hooks violation that previously blanked the modal.
  const [form, setForm] = useState(() => tx ? { ...tx, date_received: dateOnly(tx.date_received) } : {});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tx) setForm({ ...tx, date_received: dateOnly(tx.date_received) });
  }, [tx]);

  const isCreate = !tx?.id;

  // Auto fee% on create when client+method change. Hook MUST be called every
  // render — guard with a null-safe access on form.
  useEffect(() => {
    if (!isCreate) return;
    const clientId = form?.client_id;
    const method = form?.payment_method;
    if (!clientId || !method) return;
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    const map = { 'Debit/Credit Cards': 'card_pct', ACH: 'ach_pct', 'Wire Transfer': 'wire_pct', Cheque: 'cheque_pct', Zelle: 'zelle_pct' };
    const f = map[method];
    if (f) setForm((s) => ({ ...s, foundapay_fee_pct: c[f] || 0 }));
    // eslint-disable-next-line
  }, [form?.client_id, form?.payment_method]);

  if (!tx) return null;

  const canDelete = ['super_admin', 'owner'].includes(user?.role);

  const gross = parseFloat(form.gross_amount) || 0;
  const feePct = parseFloat(form.foundapay_fee_pct) || 0;
  const mc = parseFloat(form.merchant_charges) || 0;
  const commission = gross * feePct;
  const reservePct = parseFloat(form.reserve_pct) || 0;
  const reserve = gross * reservePct;
  const net = gross - commission - reserve - (form.bearing_merchant_charges === 'Client' ? mc : 0);
  const breakdownTotal = gross || 1;
  const commissionPct = (commission / breakdownTotal) * 100;
  const reservePctViz = (reserve / breakdownTotal) * 100;
  const mcPct = (mc / breakdownTotal) * 100;
  const netPct = Math.max(0, 100 - commissionPct - reservePctViz - mcPct);

  async function save() {
    setBusy(true);
    try {
      const body = {
        ...form,
        gross_amount: gross,
        foundapay_fee_pct: feePct,
        merchant_charges: mc,
        client_id: form.client_id || null,
        entity_id: form.entity_id || null,
      };
      let r;
      if (isCreate) r = await api.post('/api/transactions', body);
      else          r = await api.patch(`/api/transactions/${tx.id}`, body);
      toast.success(isCreate ? `Saved transaction #${r.id}` : `Updated transaction #${tx.id}`);
      onSaved?.(r);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function del() {
    if (!confirm(`Delete transaction #${tx.id} — ${money(tx.gross_amount)} from ${tx.counterparty_name || '—'}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/transactions/${tx.id}`);
      toast.success(`Deleted transaction #${tx.id}`);
      onDeleted?.(tx.id);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <SlideOver
      open
      onClose={onClose}
      title={isCreate ? 'New transaction' : `Transaction #${tx.id}`}
      badge={!isCreate && <Badge tone={STATUS_TONE[tx.status] || 'zinc'}>{tx.status}</Badge>}
      footer={
        <>
          {!isCreate && canDelete && (
            <Button variant="danger" onClick={del} disabled={busy} className="mr-auto">
              <Trash2 size={14} /> Delete
            </Button>
          )}
          {!isCreate && (
            <Button variant="secondary" onClick={() => downloadReceipt(tx.id)}>
              <FileText size={14} /> Receipt
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            <Save size={14} /> {busy ? 'Saving…' : (isCreate ? 'Save transaction' : 'Save changes')}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-5">
        {/* Overview */}
        {!isCreate && (
          <div>
            <Label>Overview</Label>
            <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <Badge tone={form.type === 'Received' ? 'green' : 'amber'}>{form.type}</Badge>
              <span>{dateOnly(form.date_received)}</span>
              {tx.created_at && <span>· created {new Date(tx.created_at).toLocaleString()}</span>}
            </div>
          </div>
        )}

        {/* Type + Date + Status */}
        <Row3>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option>Received</option><option>Paid</option><option>Settlement</option><option>Refund</option><option>Adjustment</option>
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date_received} onChange={(e) => setForm((f) => ({ ...f, date_received: e.target.value }))} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option>Completed</option><option>Hold</option><option>Processing</option><option>Charge Back</option>
            </Select>
          </Field>
        </Row3>

        {/* Parties */}
        <div>
          <Label>Parties</Label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Client</div>
              <Select value={form.client_id || ''} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value || null }))}>
                <option value="">—</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Counterparty type</div>
              <Select value={form.counterparty_type || 'Client'} onChange={(e) => setForm((f) => ({ ...f, counterparty_type: e.target.value }))}>
                <option>Client</option><option>Partner</option><option>Employee</option><option>Vendor</option><option>Other</option>
              </Select>
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Entity / Method</div>
          <Row3>
            <Select value={form.entity_id || ''} onChange={(e) => setForm((f) => ({ ...f, entity_id: e.target.value || null }))}>
              <option value="">—</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
            </Select>
            <Select value={form.payment_method || ''} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
              <option value="">—</option>
              <option>Debit/Credit Cards</option><option>ACH</option><option>Wire Transfer</option><option>Zelle</option><option>Cheque</option><option>PayPal</option>
            </Select>
            <Input placeholder="Merchant" value={form.merchant_account || ''} onChange={(e) => setForm((f) => ({ ...f, merchant_account: e.target.value }))} />
          </Row3>
        </div>

        {/* Financial breakdown */}
        <div>
          <Label>Financial breakdown</Label>
          {/* Visual proportional bar */}
          <div className="flex h-7 rounded overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
            {commissionPct > 0 && <div style={{ width: `${commissionPct}%`, background: 'var(--accent)' }} title={`Commission ${money(commission)}`} />}
            {mcPct > 0 && form.bearing_merchant_charges === 'Client' && <div style={{ width: `${mcPct}%`, background: 'var(--warning)' }} title={`Merchant charges ${money(mc)}`} />}
            {reservePctViz > 0 && <div style={{ width: `${reservePctViz}%`, background: 'var(--info)' }} title={`Reserve ${money(reserve)}`} />}
            {netPct > 0 && <div style={{ width: `${netPct}%`, background: 'var(--success)' }} title={`Net ${money(net)}`} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]">
            <Legend color="var(--accent)" label="Commission" />
            {form.bearing_merchant_charges === 'Client' && <Legend color="var(--warning)" label="Merchant charges" />}
            <Legend color="var(--info)" label="Reserve" />
            <Legend color="var(--success)" label="Net" />
          </div>

          <div className="grid grid-cols-3 gap-3 mt-3">
            <Field label="Gross amount">
              <Input type="number" step="0.01" value={form.gross_amount || ''} onChange={(e) => setForm((f) => ({ ...f, gross_amount: e.target.value }))} className="text-base font-semibold" />
            </Field>
            <Field label="FP fee %">
              <Input type="number" step="0.0001" value={form.foundapay_fee_pct ?? ''} onChange={(e) => setForm((f) => ({ ...f, foundapay_fee_pct: e.target.value }))} />
            </Field>
            <Field label="Merchant charges">
              <Input type="number" step="0.01" value={form.merchant_charges ?? ''} onChange={(e) => setForm((f) => ({ ...f, merchant_charges: e.target.value }))} />
            </Field>
          </div>

          <div className="flex gap-2 mt-3">
            <span className="text-[10px] uppercase tracking-wider mt-2" style={{ color: 'var(--text-tertiary)' }}>Charges borne by</span>
            {['Client', 'FoundaPay'].map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setForm((f) => ({ ...f, bearing_merchant_charges: b }))}
                className="fp-btn"
                style={{
                  background: form.bearing_merchant_charges === b ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                  color: form.bearing_merchant_charges === b ? 'var(--accent)' : 'var(--text-secondary)',
                  border: `1px solid ${form.bearing_merchant_charges === b ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >{b}</button>
            ))}
          </div>

          <div
            className="mt-3 p-3 rounded-lg flex items-center justify-between"
            style={{ background: 'var(--bg-tertiary)' }}
          >
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Net to client</div>
              <div className="text-2xl font-semibold mt-0.5" style={{ color: net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {money(net)}
              </div>
            </div>
            <div className="text-right text-xs" style={{ color: 'var(--text-secondary)' }}>
              <div>Gross: {money(gross)}</div>
              <div>− Commission: {money(commission)} ({(feePct * 100).toFixed(2)}%)</div>
              {reserve > 0 && <div>− Reserve: {money(reserve)}</div>}
              {form.bearing_merchant_charges === 'Client' && mc > 0 && <div>− MC: {money(mc)}</div>}
            </div>
          </div>
        </div>

        {/* Proof URL */}
        {!isCreate && (
          <div>
            <Label>Proof / Screenshot URL</Label>
            <div className="flex gap-2">
              <Input
                placeholder="https://drive.google.com/..."
                value={form.proof_url || ''}
                onChange={(e) => setForm((f) => ({ ...f, proof_url: e.target.value }))}
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await api.post(`/api/transactions/${tx.id}/proof`, { url: form.proof_url || '' });
                    toast.success('Proof URL saved');
                  } catch (e) { toast.error(e.message); }
                }}
              >Save</Button>
            </div>
            {form.proof_url && (
              <a
                href={form.proof_url}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-xs"
                style={{ color: 'var(--accent)' }}
              >
                <ExternalLink size={12} /> Open proof
              </a>
            )}
          </div>
        )}

        {/* Notes */}
        <div>
          <Label>Notes</Label>
          <Textarea
            rows={3}
            value={form.notes || ''}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Optional notes about this transaction..."
          />
        </div>
      </div>
    </SlideOver>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      {children}
    </div>
  );
}
function Row3({ children }) { return <div className="grid grid-cols-3 gap-3">{children}</div>; }
function Legend({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}
