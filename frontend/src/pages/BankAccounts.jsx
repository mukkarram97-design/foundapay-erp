import React, { useEffect, useState, useCallback } from 'react';
import { Plus, RefreshCw, Upload, Trash2, Edit2, Building, Link as LinkIcon, X } from 'lucide-react';
import { usePlaidLink } from 'react-plaid-link';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Textarea, Label, PageHeader, Modal, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import { toast } from '../store/toast';

export default function BankAccounts() {
  const [rows, setRows] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [openDetail, setOpenDetail] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  // Manual-balance update state — must be declared with the other hooks at top.
  const [manualBalanceFor, setManualBalanceFor] = useState(null);
  const [wiseSyncing, setWiseSyncing] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try {
      // /api/banks now prepends a synthetic Wise row when configured (is_wise=true)
      const [b, e] = await Promise.all([
        api.get('/api/banks'),
        api.get('/api/entities'),
      ]);
      setRows(b.rows);
      setEntities(e.rows);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function syncWise() {
    setWiseSyncing(true);
    try {
      // Re-fetch /api/banks — backend will pull fresh Wise balances
      await load();
      toast.success('Wise balances refreshed');
    } catch (e) { toast.error(e.message); }
    finally { setWiseSyncing(false); }
  }

  async function syncBank(row) {
    try {
      const r = await api.post(`/api/banks/${row.id}/plaid/sync`, {});
      toast.success(`Synced: ${r.added} added, ${r.modified} updated, ${r.removed} removed`);
      load();
    } catch (e) { toast.error(e.message); }
  }
  async function refreshBalance(row) {
    try {
      const r = await api.post(`/api/banks/${row.id}/plaid/refresh-balance`, {});
      toast.success(`Balance: ${money(r.current_balance)}`);
      load();
    } catch (e) { toast.error(e.message); }
  }
  async function deleteBank() {
    try {
      await api.delete(`/api/banks/${confirmDelete.id}`);
      toast.success('Bank account removed');
      setConfirmDelete(null);
      load();
    } catch (e) { toast.error(e.message); }
  }

  const totalBalance = rows.reduce((s, r) => s + (parseFloat(r.current_balance) || 0), 0);
  const accountCount = rows.length;

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Bank Accounts"
        subtitle={`${accountCount} accounts · Total balance ${money(totalBalance)} (USD-equivalent)`}
        actions={
          <div className="flex gap-2">
            <PlaidLinkButton entities={entities} onLinked={load} />
            <Button variant="secondary" onClick={() => setOpenCreate(true)}><Plus size={14} /> Add manually</Button>
          </div>
        }
      />

      {err && <Alert tone="error" className="mb-4">{err}</Alert>}

      {loading && rows.length === 0 && (
        <Card className="p-6" style={{ color: 'var(--text-secondary)' }}>Loading bank accounts…</Card>
      )}

      {!loading && rows.length === 0 && (
        <Card className="p-12" style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>No bank accounts yet</div>
          <div className="flex gap-2 justify-center">
            <PlaidLinkButton entities={entities} onLinked={load} />
            <Button variant="secondary" onClick={() => setOpenCreate(true)}><Plus size={14} /> Add manually</Button>
          </div>
        </Card>
      )}

      {/* Unified card grid — Wise (synthetic row from backend) appears alongside regular banks */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {!loading && rows.map((r) => r.is_wise ? (
          <WiseAccountCard
            key={r.id}
            row={r}
            syncing={wiseSyncing}
            onSync={syncWise}
          />
        ) : (
          <BankCard
            key={r.id}
            row={r}
            onSync={() => syncBank(r)}
            onRefreshBalance={() => refreshBalance(r)}
            onManualBalance={() => setManualBalanceFor(r)}
            onEdit={() => setEditing(r)}
            onDelete={() => setConfirmDelete(r)}
            onView={() => setOpenDetail(r)}
          />
        ))}
      </div>

      {manualBalanceFor && (
        <ManualBalanceModal
          row={manualBalanceFor}
          onClose={() => setManualBalanceFor(null)}
          onSaved={() => { setManualBalanceFor(null); load(); }}
        />
      )}

      {(openCreate || editing) && (
        <BankForm
          bank={editing}
          entities={entities}
          onClose={() => { setOpenCreate(false); setEditing(null); }}
          onSaved={() => { setOpenCreate(false); setEditing(null); load(); }}
        />
      )}

      {openDetail && (
        <BankDetail
          row={openDetail}
          onClose={() => setOpenDetail(null)}
          onChanged={() => { load(); }}
          onSync={() => syncBank(openDetail)}
          onRefreshBalance={() => refreshBalance(openDetail)}
        />
      )}

      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(null)} title="Remove bank account?"
          footer={<>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={deleteBank}>Remove</Button>
          </>}>
          <p>Soft-delete <strong>{confirmDelete.bank_name}</strong> ({confirmDelete.account_last4 ? `••${confirmDelete.account_last4}` : 'no last4'})? Plaid linkage will remain in DB but the account is hidden from listings.</p>
        </Modal>
      )}
    </div>
  );
}

// ━━━ Sync method label/icon helpers ━━━
function SyncMethodBadge({ method, lastSyncedAt }) {
  const cfg = ({
    wise:    { icon: '🟢', label: 'Wise API · auto sync',    tone: 'success' },
    plaid:   { icon: '🟢', label: 'Plaid Connected · auto sync', tone: 'success' },
    manual:  { icon: '🟡', label: 'Manual · update manually', tone: 'warning' },
    none:    { icon: '⚪', label: 'Not configured',           tone: 'neutral' },
  })[method] || { icon: '⚪', label: 'Unknown', tone: 'neutral' };
  return (
    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
      <span style={{ marginRight: 4 }}>{cfg.icon}</span>{cfg.label}
      {lastSyncedAt && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
        Last synced: {new Date(lastSyncedAt).toLocaleString()}
      </div>}
    </div>
  );
}

// ━━━ Standard bank card (Plaid / Manual / Not connected) ━━━
function BankCard({ row, onSync, onRefreshBalance, onManualBalance, onEdit, onDelete, onView }) {
  const method = row.plaid_connected ? 'plaid' : 'manual';
  const initial = (row.bank_name || row.account_nickname || '?').charAt(0).toUpperCase();

  function handleSync() {
    if (method === 'plaid') {
      onRefreshBalance(); // refresh Plaid balance
      onSync();           // and pull new transactions
    } else {
      onManualBalance();
    }
  }

  return (
    <Card className="p-4 cursor-pointer" onClick={onView}>
      <div className="flex items-start gap-3 mb-3">
        <div style={{ width: 48, height: 48, borderRadius: 10, background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, flexShrink: 0 }}>
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }} className="truncate">
            {row.account_nickname || row.bank_name || '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }} className="truncate">
            {row.bank_name && row.account_nickname && row.bank_name !== row.account_nickname ? row.bank_name : 'Bank account'}
            {row.account_last4 && ` · ••${row.account_last4}`}
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 6 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>Current balance</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
          {money(row.current_balance)}
        </div>
        <div className="mt-2">
          <SyncMethodBadge method={method} lastSyncedAt={row.plaid_synced_at} />
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
        <Button variant="secondary" size="sm" onClick={handleSync}>
          <RefreshCw size={12} /> {method === 'plaid' ? 'Sync now' : 'Update balance'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit} title="Edit"><Edit2 size={12} /></Button>
        <Button variant="ghost" size="sm" onClick={onDelete} title="Delete"><Trash2 size={12} /></Button>
      </div>
    </Card>
  );
}

// ━━━ Wise multi-currency card — receives synthetic row from /api/banks ━━━
function WiseAccountCard({ row, syncing, onSync }) {
  const balances = row.all_balances || [];
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3 mb-3">
        <div style={{ width: 48, height: 48, borderRadius: 10, background: 'linear-gradient(135deg,#9FE870 0%,#00B9FF 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: '#0E2C0E', flexShrink: 0 }}>
          W
        </div>
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }} className="truncate">
            {row.account_nickname || 'Nextgenase Inc — Wise'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {row.account_type || 'Multi-currency Account'} · Live API
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 6 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>Primary balance (USD)</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
          {money(row.current_balance, 'USD')}
        </div>
        {balances.length > 1 && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            {balances.filter((b) => (b.currency || b.amount?.currency) !== 'USD').map((b, i) => {
              const cur = b.currency || b.amount?.currency || '—';
              const amt = b.amount?.value ?? b.amount ?? 0;
              return (
                <div key={i} style={{
                  fontSize: 13, padding: '6px 10px', borderRadius: 6,
                  background: 'var(--bg-tertiary)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{cur}</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: parseFloat(amt) > 0 ? 600 : 400, color: parseFloat(amt) > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                    {money(amt, cur)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3">
          <SyncMethodBadge method="wise" lastSyncedAt={row.plaid_synced_at} />
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <Button variant="secondary" size="sm" onClick={onSync} disabled={syncing}>
          <RefreshCw size={12} /> {syncing ? 'Syncing…' : 'Sync'}
        </Button>
        <a href="/remittance" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>📊 Transactions →</a>
      </div>
    </Card>
  );
}

// ━━━ Manual balance update modal ━━━
function ManualBalanceModal({ row, onClose, onSaved }) {
  const [balance, setBalance] = useState(row.current_balance || 0);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const noteSuffix = notes ? ` — ${notes}` : '';
      const composedNotes = (row.notes ? `${row.notes}\n` : '') +
        `[${asOf}] Manual balance update: ${money(balance)}${noteSuffix}`;
      await api.put(`/api/banks/${row.id}`, {
        current_balance: parseFloat(balance) || 0,
        notes: composedNotes,
      });
      toast.success(`Balance updated for ${row.bank_name || 'bank'}`);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Update balance — ${row.account_nickname || row.bank_name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save balance'}</Button>
      </>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Current balance ($)</Label>
          <Input type="number" step="0.01" value={balance}
            onChange={(e) => setBalance(e.target.value)} autoFocus
            style={{ height: 44, fontSize: 18, fontWeight: 600 }} />
        </div>
        <div><Label>As of date</Label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <div><Label>Notes (optional)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="From bank statement" />
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 12 }}>
        This appends to the bank's notes for an audit trail. For Plaid-connected banks, use the Sync button instead to pull live data.
      </div>
    </Modal>
  );
}

// ━━━ Plaid Link button ━━━
function PlaidLinkButton({ entities, onLinked }) {
  const [linkToken, setLinkToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openExchange, setOpenExchange] = useState(false);
  const [pendingPublicToken, setPendingPublicToken] = useState(null);
  const [pendingMeta, setPendingMeta] = useState(null);

  async function startLink() {
    setBusy(true);
    try {
      const r = await api.post('/api/banks/plaid/link-token', {});
      setLinkToken(r.link_token);
    } catch (e) {
      toast.error(e.message || 'Could not init Plaid');
      setBusy(false);
    }
  }

  const onSuccess = useCallback(async (public_token, metadata) => {
    setLinkToken(null);
    setBusy(false);
    setPendingPublicToken(public_token);
    setPendingMeta(metadata);
    setOpenExchange(true);
  }, []);

  const onExit = useCallback(() => { setLinkToken(null); setBusy(false); }, []);

  const config = { token: linkToken, onSuccess, onExit };
  const { open, ready } = usePlaidLink(config);
  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);

  return (
    <>
      <Button onClick={startLink} disabled={busy}>
        <LinkIcon size={14} /> {busy ? 'Connecting…' : 'Connect via Plaid'}
      </Button>

      {openExchange && (
        <PlaidExchangeModal
          publicToken={pendingPublicToken}
          metadata={pendingMeta}
          entities={entities}
          onClose={() => { setOpenExchange(false); setPendingPublicToken(null); setPendingMeta(null); }}
          onLinked={() => {
            setOpenExchange(false);
            setPendingPublicToken(null);
            setPendingMeta(null);
            onLinked?.();
            toast.success('Bank linked via Plaid');
          }}
        />
      )}
    </>
  );
}

function PlaidExchangeModal({ publicToken, metadata, entities, onClose, onLinked }) {
  const accounts = metadata?.accounts || [];
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [entityId, setEntityId] = useState('');
  const [nickname, setNickname] = useState(accounts[0]?.name || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function exchange() {
    setSaving(true); setErr(null);
    try {
      await api.post('/api/banks/plaid/exchange', {
        public_token: publicToken,
        account_id: accountId,
        entity_id: entityId || null,
        account_nickname: nickname || null,
      });
      onLinked();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="Confirm bank link"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={exchange} disabled={saving || !accountId}>{saving ? 'Linking…' : 'Confirm & save'}</Button>
      </>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="mb-3">
        <Label>Institution</Label>
        <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{metadata?.institution?.name || 'Linked institution'}</div>
      </div>
      <div className="mb-3">
        <Label>Account</Label>
        <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); const a = accounts.find((x) => x.id === e.target.value); if (a) setNickname(a.name); }}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} {a.mask ? `••${a.mask}` : ''} ({a.subtype})
            </option>
          ))}
        </Select>
      </div>
      <div className="mb-3">
        <Label>Assign to entity (optional)</Label>
        <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
          <option value="">— No entity —</option>
          {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
        </Select>
      </div>
      <div>
        <Label>Nickname</Label>
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </div>
    </Modal>
  );
}

// ━━━ Manual bank create / edit form ━━━
function BankForm({ bank, entities, onClose, onSaved }) {
  const [form, setForm] = useState(bank || {
    bank_name: '', account_nickname: '', account_last4: '',
    routing_reference: '', zelle_id: '', entity_id: '',
    opening_balance: 0, current_balance: 0, status: 'active', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = {
        ...form,
        opening_balance: parseFloat(form.opening_balance) || 0,
        current_balance: parseFloat(form.current_balance) || 0,
      };
      if (bank) await api.put(`/api/banks/${bank.id}`, body);
      else      await api.post('/api/banks', body);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={bank ? `Edit ${bank.bank_name}` : 'Add bank account'} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Bank name</Label><Input value={form.bank_name || ''} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} /></div>
        <div><Label>Nickname</Label><Input value={form.account_nickname || ''} onChange={(e) => setForm((f) => ({ ...f, account_nickname: e.target.value }))} /></div>
        <div><Label>Account last 4</Label><Input maxLength="4" value={form.account_last4 || ''} onChange={(e) => setForm((f) => ({ ...f, account_last4: e.target.value }))} /></div>
        <div><Label>Routing / reference</Label><Input value={form.routing_reference || ''} onChange={(e) => setForm((f) => ({ ...f, routing_reference: e.target.value }))} /></div>
        <div><Label>Zelle ID</Label><Input value={form.zelle_id || ''} onChange={(e) => setForm((f) => ({ ...f, zelle_id: e.target.value }))} /></div>
        <div><Label>Entity</Label>
          <Select value={form.entity_id || ''} onChange={(e) => setForm((f) => ({ ...f, entity_id: e.target.value || null }))}>
            <option value="">— None —</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
          </Select>
        </div>
        <div><Label>Opening balance</Label><Input type="number" step="0.01" value={form.opening_balance || 0} onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))} /></div>
        <div><Label>Current balance</Label><Input type="number" step="0.01" value={form.current_balance || 0} onChange={(e) => setForm((f) => ({ ...f, current_balance: e.target.value }))} /></div>
        <div><Label>Status</Label>
          <Select value={form.status || 'active'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </Select>
        </div>
        <div className="col-span-2"><Label>Notes</Label><Textarea rows="2" value={form.notes || ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}

// ━━━ Detail slide-over ━━━
function BankDetail({ row, onClose, onChanged, onSync, onRefreshBalance }) {
  const [detail, setDetail] = useState(null);
  const [csvBusy, setCsvBusy] = useState(false);

  useEffect(() => {
    api.get(`/api/banks/${row.id}`).then(setDetail).catch(() => setDetail({ bank: row, transactions: [] }));
  }, [row.id]);

  async function uploadCsv(file) {
    setCsvBusy(true);
    try {
      const fd = new FormData();
      fd.append('csv', file);
      const token = localStorage.getItem('foundapay_token');
      const res = await fetch(`/api/banks/${row.id}/csv`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
      const j = await res.json();
      toast.success(`Imported ${j.imported} rows`);
      onChanged?.();
      // Refresh detail
      api.get(`/api/banks/${row.id}`).then(setDetail);
    } catch (e) { toast.error(e.message); }
    finally { setCsvBusy(false); }
  }

  const bank = detail?.bank || row;
  const tx = detail?.transactions || [];

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', zIndex: 1100, display: 'flex', justifyContent: 'flex-end' }}>
      <div className="fp-card" style={{ width: '100%', maxWidth: 720, height: '100vh', overflowY: 'auto', borderRadius: 0, padding: 24 }}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bank account</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{bank.account_nickname || bank.bank_name}</h2>
            <div className="mt-1 flex items-center gap-2">
              <span style={{ fontSize: 22, fontWeight: 600 }}>{money(bank.current_balance)}</span>
              {bank.plaid_connected ? <Badge tone="success">Plaid</Badge> : <Badge tone="zinc">Manual</Badge>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={22} />
          </button>
        </div>

        <Card className="p-4 mb-3">
          <div className="flex gap-2 flex-wrap">
            {bank.plaid_connected && (
              <>
                <Button variant="secondary" onClick={onSync}><RefreshCw size={14} /> Sync transactions</Button>
                <Button variant="secondary" onClick={onRefreshBalance}><Building size={14} /> Refresh balance</Button>
              </>
            )}
            <label className="fp-btn fp-btn-secondary" style={{ cursor: csvBusy ? 'not-allowed' : 'pointer' }}>
              <Upload size={14} /> {csvBusy ? 'Importing…' : 'Upload CSV'}
              <input type="file" accept=".csv" hidden onChange={(e) => e.target.files[0] && uploadCsv(e.target.files[0])} />
            </label>
          </div>
          <p className="mt-2" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            CSV columns expected: <code>posted_date, description, amount</code> (optional: merchant_name, category)
          </p>
        </Card>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Bank" value={bank.bank_name} />
          <Field label="Entity" value={bank.entity_name} />
          <Field label="Last 4" value={bank.account_last4 ? `••${bank.account_last4}` : null} mono />
          <Field label="Routing" value={bank.routing_reference} mono />
          <Field label="Status" value={bank.status} />
          <Field label="Last synced" value={bank.plaid_synced_at ? new Date(bank.plaid_synced_at).toLocaleString() : null} />
          {bank.institution_name && <Field label="Institution" value={bank.institution_name} />}
        </div>

        <Card className="p-4">
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>Transactions</div>
          {tx.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No transactions yet. Sync via Plaid or upload a CSV.</div>}
          {tx.length > 0 && (
            <Table>
              <Thead>
                <Tr>
                  <Th>Date</Th>
                  <Th>Description</Th>
                  <Th>Category</Th>
                  <Th className="text-right">Amount</Th>
                </Tr>
              </Thead>
              <tbody>
                {tx.map((t) => (
                  <Tr key={t.id}>
                    <Td className="text-xs">{dateOnly(t.posted_date)}</Td>
                    <Td>
                      <div style={{ fontSize: 12 }}>{t.description || '—'}</div>
                      {t.merchant_name && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t.merchant_name}</div>}
                    </Td>
                    <Td className="text-xs">{t.category || '—'}</Td>
                    <Td className="text-right font-mono" style={{ color: parseFloat(t.amount) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {parseFloat(t.amount) >= 0 ? '+' : ''}{money(t.amount)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 13, marginTop: 2, fontFamily: mono ? 'ui-monospace, monospace' : 'inherit' }}>{value || '—'}</div>
    </div>
  );
}
