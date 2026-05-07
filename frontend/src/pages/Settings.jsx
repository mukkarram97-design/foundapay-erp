import React, { useEffect, useState } from 'react';
import { Activity, Lock, Trash2, ShieldCheck, AlertTriangle, CheckCircle2, Plus, Edit2 } from 'lucide-react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Alert, Badge, Modal } from '../components/ui';
import { toast } from '../store/toast';

export default function Settings() {
  const [cms, setCms] = useState({});
  const [editKey, setEditKey] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(null);

  async function load() {
    try { setCms(await api.get('/api/cms')); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  function startEdit(key) {
    setEditKey(key);
    setEditVal(JSON.stringify(cms[key], null, 2));
  }

  async function save() {
    try {
      const value = JSON.parse(editVal);
      await api.patch(`/api/cms/${editKey}`, { value });
      setSaved(`Saved ${editKey}`);
      setEditKey(null);
      load();
      setTimeout(() => setSaved(null), 3000);
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <PageHeader title="Settings" subtitle="Integrations, system configuration & editable lists" />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      {saved && <div className="mb-4"><Alert tone="success">{saved}</Alert></div>}

      <IntegrationsSection />

      <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginTop: 32, marginBottom: 12 }}>
        CMS · Editable lists
      </h2>
      <div className="grid grid-cols-1 gap-3">
        {Object.entries(cms).map(([key, value]) => (
          <Card key={key} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-[var(--text-primary)] font-mono">{key}</div>
                {Array.isArray(value) ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {value.map((v, i) => <Badge key={i}>{String(v)}</Badge>)}
                  </div>
                ) : (
                  <pre className="mt-2 text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
                )}
              </div>
              <Button variant="secondary" onClick={() => startEdit(key)}>Edit</Button>
            </div>
            {editKey === key && (
              <div className="mt-3">
                <Label>Edit JSON</Label>
                <textarea
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  rows={8}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border)] focus:border-blue-500 focus:outline-none rounded-lg px-3 py-2 text-[var(--text-primary)] font-mono text-xs"
                />
                <div className="flex gap-2 mt-2">
                  <Button onClick={save}>Save</Button>
                  <Button variant="ghost" onClick={() => setEditKey(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </Card>
        ))}
        {Object.keys(cms).length === 0 && <Card className="p-6 text-[var(--text-tertiary)]">No CMS settings yet</Card>}
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Integrations section — encrypted credential vault.
// Tokens never leave the server: GET only returns "configured + metadata".
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function IntegrationsSection() {
  // Renamed conceptually to "Remittance Channels" — Wise + bank/RIA rails
  // live under one section, picked via sub-tabs. Wise is its own integration
  // (encrypted API token); bank/RIA are operator-managed records used as
  // "send from" options on the Remittance page.
  const [overview, setOverview] = useState(null);
  const [err, setErr] = useState(null);
  const [subTab, setSubTab] = useState('wise'); // 'wise' | 'bank' | 'manual'

  async function load() {
    setErr(null);
    try {
      const r = await api.get('/api/settings/integrations');
      setOverview(r);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  if (err) return <Alert tone="error" className="mb-4">{err}</Alert>;
  if (!overview) return <Card className="p-5" style={{ color: 'var(--text-secondary)' }}>Loading integrations…</Card>;

  const SUBS = [
    { id: 'wise',   label: 'Wise' },
    { id: 'bank',   label: 'Bank / RIA' },
    { id: 'manual', label: 'Manual Wire' },
  ];

  return (
    <>
      <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 12 }}>
        Remittance Channels
      </h2>
      {!overview.cryptoConfigured && subTab === 'wise' && (
        <Alert tone="warning" className="mb-3" icon={<AlertTriangle size={14} />}>
          <strong>APP_ENCRYPTION_KEY missing on server.</strong> Add it to <code>.env</code> (≥16 chars) and restart pm2.
          Until then, tokens cannot be saved or read from the encrypted vault.
        </Alert>
      )}

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
        {SUBS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding: '8px 14px', fontSize: 13, fontWeight: 500,
              color: subTab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${subTab === t.id ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1, cursor: 'pointer',
            }}
          >{t.label}</button>
        ))}
      </div>

      {subTab === 'wise' && (
        <WiseIntegrationCard status={overview.providers?.wise} disabled={!overview.cryptoConfigured} onChanged={load} />
      )}
      {subTab === 'bank'   && <BankRiaChannels />}
      {subTab === 'manual' && <ManualWireTemplate />}
    </>
  );
}

// ━━━ Bank / RIA channels — CRUD over /api/remittance-channels ━━
function BankRiaChannels() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null); // null | row | 'new'

  async function load() {
    try {
      const r = await api.get('/api/remittance-channels');
      // Show every non-Wise channel here. (Wise lives in its own sub-tab.)
      setRows((r.rows || []).filter((x) => x.channel_type !== 'wise_api'));
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function archive(row) {
    if (!window.confirm(`Delete "${row.name}"?`)) return;
    try {
      await api.delete(`/api/remittance-channels/${row.id}`);
      toast.success('Channel removed');
      load();
    } catch (e) { toast.error(e.message); }
  }

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!rows) return <Card className="p-5" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Bank wires, RIA, MoneyGram, hawala</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Operator-managed sending rails. Each one shows up as a "From account" option in the Remittance flow.
          </div>
        </div>
        <Button onClick={() => setEditing('new')}><Plus size={14} /> Add channel</Button>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
          No bank/RIA channels yet. Add the first one to enable manual remittance flows.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((r) => (
            <div key={r.id} style={{
              border: '1px solid var(--border)', borderRadius: 10, padding: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              background: r.is_active ? 'var(--bg-primary)' : 'var(--bg-tertiary)',
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</span>
                  <Badge tone={r.is_active ? 'success' : 'zinc'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>
                  <Badge tone="info">{r.channel_type}</Badge>
                </div>
                {r.account_reference && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'ui-monospace, monospace' }}>{r.account_reference}</div>
                )}
                {r.instructions && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.instructions}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <Button variant="secondary" size="sm" onClick={() => setEditing(r)}><Edit2 size={12} /> Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => archive(r)}><Trash2 size={12} /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ChannelModal
          channel={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </Card>
  );
}

function ChannelModal({ channel, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:              channel?.name              || '',
    channel_type:      channel?.channel_type      || 'wire',
    account_reference: channel?.account_reference || '',
    instructions:      channel?.instructions      || '',
    is_active:         channel?.is_active !== false,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      if (channel?.id) await api.put(`/api/remittance-channels/${channel.id}`, form);
      else             await api.post('/api/remittance-channels', form);
      toast.success(channel ? 'Channel updated' : 'Channel created');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={channel ? `Edit ${channel.name}` : 'New remittance channel'}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !form.name}>{saving ? 'Saving…' : 'Save'}</Button>
      </>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Name *</Label>
          <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Western Union" />
        </div>
        <div>
          <Label>Type</Label>
          <Select value={form.channel_type} onChange={(e) => setForm(f => ({ ...f, channel_type: e.target.value }))}>
            <option value="wire">Wire</option>
            <option value="ria">RIA</option>
            <option value="moneygram">MoneyGram</option>
            <option value="hawala">Hawala</option>
            <option value="swift">SWIFT</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div>
          <Label>Active</Label>
          <Select value={form.is_active ? '1' : '0'} onChange={(e) => setForm(f => ({ ...f, is_active: e.target.value === '1' }))}>
            <option value="1">Yes</option>
            <option value="0">No</option>
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Account / Reference</Label>
          <Input value={form.account_reference} onChange={(e) => setForm(f => ({ ...f, account_reference: e.target.value }))} placeholder="Account 1234567890 · Routing 0000" />
        </div>
        <div className="col-span-2">
          <Label>Instructions / Notes</Label>
          <textarea
            className="fp-input"
            rows={3}
            style={{ width: '100%', resize: 'vertical' }}
            value={form.instructions}
            onChange={(e) => setForm(f => ({ ...f, instructions: e.target.value }))}
            placeholder="Bank: Chase  ·  SWIFT: CHASUS33  ·  Bene name: ..."
          />
        </div>
      </div>
    </Modal>
  );
}

// ━━━ Manual wire template — single CMS-backed text blob for now ━━
function ManualWireTemplate() {
  return (
    <Card className="p-5">
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        Manual wire instructions template
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
        Default wire instructions shown when an operator picks "Manual Wire" in the Remittance flow.
        Edit the <code>manual_wire_template</code> entry below in the CMS list to update it; the value
        is rendered verbatim on the new-transfer step.
      </div>
      <Alert tone="info">
        Coming soon: in-place template editor. For now, scroll down to the CMS list and edit the
        <code> manual_wire_template</code> key (creates one if missing).
      </Alert>
    </Card>
  );
}

function WiseIntegrationCard({ status, disabled, onChanged }) {
  const configured = !!status?.configured;
  const meta = status?.metadata || {};
  const lastTest = status?.lastTest;

  const [form, setForm] = useState({
    token: '',
    profile_id: meta.profile_id || '',
    environment: meta.environment || 'live',
  });
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Reflect remote metadata when status updates
  useEffect(() => {
    setForm((f) => ({
      ...f,
      profile_id: meta.profile_id || '',
      environment: meta.environment || f.environment || 'live',
    }));
    // eslint-disable-next-line
  }, [status?.configured, meta.profile_id, meta.environment]);

  async function save() {
    setSaving(true); setTestResult(null);
    try {
      const body = {
        profile_id: form.profile_id || null,
        environment: form.environment || 'live',
      };
      if (form.token) body.token = form.token;
      await api.post('/api/settings/integrations/wise', body);
      toast.success('Wise credentials saved');
      setForm((f) => ({ ...f, token: '' })); // clear in-memory token
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true); setTestResult(null);
    try {
      const r = await api.post('/api/settings/integrations/wise/test', {});
      setTestResult({ ok: true, message: r.message, latency: r.latency });
      toast.success('Wise connection verified');
      onChanged();
    } catch (e) {
      setTestResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  }

  async function clearCreds() {
    setSaving(true);
    try {
      await api.delete('/api/settings/integrations/wise');
      toast.success('Wise credentials cleared');
      setConfirmClear(false);
      setForm({ token: '', profile_id: '', environment: 'live' });
      onChanged();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  const StatusBadge = () => {
    if (!configured) return <Badge tone="zinc">Not configured</Badge>;
    if (lastTest?.status === 'ok') return <Badge tone="success">Configured · Tested OK</Badge>;
    if (lastTest?.status === 'error') return <Badge tone="danger">Configured · Last test failed</Badge>;
    return <Badge tone="info">Configured · Untested</Badge>;
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={16} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Wise (TransferWise)</span>
            <StatusBadge />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {configured
              ? <>API token stored encrypted (AES-256-GCM). Saved on {status?.configuredAt ? new Date(status.configuredAt).toLocaleString() : '—'}.</>
              : 'Add your personal access token to enable Wise transfers from /remittance.'}
          </div>
        </div>
        {configured && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} disabled={saving}>
            <Trash2 size={12} /> Clear
          </Button>
        )}
      </div>

      {confirmClear && (
        <Alert tone="warning" className="mb-3">
          <div style={{ marginBottom: 8 }}>Clear stored Wise credentials? This cannot be undone — you'll need to re-paste the token.</div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={clearCreds}>Clear credentials</Button>
          </div>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <Label>API Token <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
            (encrypted on save · never shown again · paste to replace)
          </span></Label>
          <div style={{ position: 'relative' }}>
            <Input
              type={showToken ? 'text' : 'password'}
              autoComplete="off"
              spellCheck="false"
              placeholder={configured ? '•••••••••••••• (stored encrypted)' : 'Paste Wise personal access token'}
              value={form.token}
              onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
              disabled={disabled}
              style={{ paddingRight: 80, fontFamily: 'ui-monospace, monospace' }}
            />
            <button
              type="button"
              onClick={() => setShowToken((s) => !s)}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'transparent', border: 'none', color: 'var(--text-tertiary)',
                fontSize: 11, cursor: 'pointer', padding: '4px 8px',
              }}
            >{showToken ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        <div>
          <Label>Environment</Label>
          <Select value={form.environment} onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))} disabled={disabled}>
            <option value="live">Live</option>
            <option value="sandbox">Sandbox</option>
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label>Profile ID</Label>
          <Input
            type="text"
            placeholder="e.g. 66816660"
            value={form.profile_id}
            onChange={(e) => setForm((f) => ({ ...f, profile_id: e.target.value }))}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-4">
        <Button onClick={save} disabled={saving || disabled || (!form.token && !form.profile_id && form.environment === meta.environment)}>
          <Lock size={12} /> {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={test} disabled={testing || disabled || !configured}>
          <Activity size={12} /> {testing ? 'Testing…' : 'Test connection'}
        </Button>
        {testResult && (
          <span style={{ fontSize: 12, color: testResult.ok ? 'var(--success)' : 'var(--danger)' }}>
            {testResult.ok ? <CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4 }} /> : <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />}
            {testResult.message}
          </span>
        )}
      </div>

      {lastTest && !testResult && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
          Last test: {new Date(lastTest.at).toLocaleString()} · {lastTest.status === 'ok' ? '✅' : '❌'} {lastTest.message}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 14, lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
        🔒 <strong>How this works:</strong> the token is encrypted with AES-256-GCM using a key derived from <code>APP_ENCRYPTION_KEY</code> on the server.
        It's stored only in <code>integration_credentials</code> as ciphertext + IV + auth tag — never plain text.
        The frontend never receives it after saving; <em>Test connection</em> decrypts in memory on the server, hits Wise, and discards the plaintext.
      </div>
    </Card>
  );
}
