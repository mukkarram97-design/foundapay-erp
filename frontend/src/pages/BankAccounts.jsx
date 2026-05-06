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
  // Synthetic Wise multi-currency account (lives in Wise, not the banks table).
  const [wiseBalances, setWiseBalances] = useState(null);
  const [wiseSyncing, setWiseSyncing] = useState(false);
  const [wiseErr, setWiseErr] = useState(null);

  async function loadWise() {
    setWiseSyncing(true); setWiseErr(null);
    try {
      const r = await api.get('/api/wise/balances');
      setWiseBalances(r.balances || []);
    } catch (e) { setWiseErr(e.message); setWiseBalances(null); }
    finally { setWiseSyncing(false); }
  }
  useEffect(() => { loadWise(); }, []);

  async function load() {
    setLoading(true); setErr(null);
    try {
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

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Bank Accounts"
        subtitle={`${rows.length} accounts · Total balance ${money(totalBalance)}`}
        actions={
          <div className="flex gap-2">
            <PlaidLinkButton entities={entities} onLinked={load} />
            <Button variant="secondary" onClick={() => setOpenCreate(true)}><Plus size={14} /> Add manually</Button>
          </div>
        }
      />

      {err && <Alert tone="error" className="mb-4">{err}</Alert>}

      {/* Wise multi-currency account (synthetic — lives in Wise, not banks table) */}
      <WiseAccountCard balances={wiseBalances} err={wiseErr} syncing={wiseSyncing} onSync={loadWise} />

      <Card style={{ overflow: 'visible' }}>
        <Table>
          <Thead>
            <Tr>
              <Th>Bank / Nickname</Th>
              <Th>Entity</Th>
              <Th>Last 4</Th>
              <Th className="text-right">Current balance</Th>
              <Th>Source</Th>
              <Th>Last synced</Th>
              <Th>Status</Th>
              <Th style={{ width: 200 }}></Th>
            </Tr>
          </Thead>
          <tbody>
            {loading && <Tr><Td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</Td></Tr>}
            {!loading && rows.length === 0 && (
              <Tr><Td colSpan="8" style={{ textAlign: 'center', padding: 32 }}>
                <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>No bank accounts yet</div>
                <PlaidLinkButton entities={entities} onLinked={load} />
              </Td></Tr>
            )}
            {!loading && rows.map((r) => (
              <Tr key={r.id} clickable onClick={() => setOpenDetail(r)}>
                <Td>
                  <div className="font-medium">{r.account_nickname || r.bank_name || '—'}</div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{r.bank_name}</div>
                </Td>
                <Td>{r.entity_name || '—'}</Td>
                <Td className="font-mono text-xs">{r.account_last4 ? `••${r.account_last4}` : '—'}</Td>
                <Td className="text-right font-mono">{money(r.current_balance)}</Td>
                <Td>{r.plaid_connected ? <Badge tone="success">Plaid</Badge> : <Badge tone="zinc">Manual</Badge>}</Td>
                <Td className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {r.plaid_synced_at ? new Date(r.plaid_synced_at).toLocaleString() : '—'}
                </Td>
                <Td><Badge tone={r.status === 'active' ? 'success' : 'zinc'}>{r.status}</Badge></Td>
                <Td onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    {r.plaid_connected && (
                      <Button variant="secondary" size="sm" onClick={() => syncBank(r)} title="Sync transactions">
                        <RefreshCw size={12} /> Sync
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)} title="Edit"><Edit2 size={12} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(r)} title="Delete"><Trash2 size={12} /></Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

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

// ━━━ Wise multi-currency account card ━━━
function WiseAccountCard({ balances, err, syncing, onSync }) {
  const total = Array.isArray(balances)
    ? balances.reduce((s, b) => s + (parseFloat(b.amount?.value ?? b.amount) || 0), 0)
    : 0;
  if (!balances && !err) return null; // not configured yet
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-start gap-3 mb-3">
        <div style={{ width: 56, height: 56, borderRadius: 10, background: 'linear-gradient(135deg,#9FE870 0%,#00B9FF 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: '#0E2C0E' }}>
          W
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Wise — Nextgenase Inc</div>
            <Badge tone="info">Multi-currency</Badge>
            {!err && <Badge tone="success">Live</Badge>}
            {err && <Badge tone="danger">Error</Badge>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Held in Wise · transfers go through <a href="/remittance" style={{ color: 'var(--accent)' }}>Remittance</a>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onSync} disabled={syncing}>
          <RefreshCw size={12} /> {syncing ? 'Syncing…' : 'Sync balance'}
        </Button>
      </div>

      {err && <Alert tone="error" className="mb-2">{err}</Alert>}

      {Array.isArray(balances) && balances.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {balances.map((b, i) => {
            const cur = b.currency || b.amount?.currency || '—';
            const amt = b.amount?.value ?? b.amount ?? 0;
            return (
              <div key={i} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{cur}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: parseFloat(amt) > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                  {money(amt, cur)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {Array.isArray(balances) && balances.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No balances yet on this Wise account.</div>
      )}
    </Card>
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
