import React, { useEffect, useState } from 'react';
import {
  Plus, RefreshCw, Edit2, Trash2, Upload, Activity, Eye, EyeOff,
} from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Textarea, Label, PageHeader, Modal, Alert, Badge, money,
} from '../components/ui';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';

const PROCESSORS = [
  { id: 'authnet',      label: 'Authorize.net' },
  { id: 'stripe',       label: 'Stripe' },
  { id: 'square',       label: 'Square' },
  { id: 'nmi',          label: 'NMI' },
  { id: 'paymentcloud', label: 'PaymentCloud' },
  { id: 'paypal',       label: 'PayPal / Braintree' },
  { id: 'manual',       label: 'Manual / Wire' },
];

const CRED_FIELDS = {
  authnet: [
    { key: 'api_login_id',      label: 'API Login ID' },
    { key: 'transaction_key',   label: 'Transaction Key', secret: true },
    { key: 'public_client_key', label: 'Public Client Key' },
  ],
  stripe: [
    { key: 'publishable_key', label: 'Publishable Key' },
    { key: 'secret_key',      label: 'Secret Key', secret: true },
    { key: 'webhook_secret',  label: 'Webhook Secret (optional)', secret: true },
  ],
  square: [
    { key: 'application_id', label: 'Application ID' },
    { key: 'access_token',   label: 'Access Token', secret: true },
    { key: 'location_id',    label: 'Location ID' },
  ],
  nmi: [
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
  ],
  paymentcloud: [
    { key: 'api_key',     label: 'API Key', secret: true },
    { key: 'merchant_id', label: 'Merchant ID' },
  ],
  paypal: [
    { key: 'client_id',     label: 'Client ID' },
    { key: 'client_secret', label: 'Client Secret', secret: true },
  ],
  manual: [
    { key: 'bank_name',          label: 'Bank Name' },
    { key: 'account_number',     label: 'Account Number' },
    { key: 'routing_number',     label: 'Routing Number' },
    { key: 'wire_instructions',  label: 'Wire Instructions', textarea: true },
  ],
};

const METHODS = [
  { id: 'cards',  label: 'Credit/Debit Cards' },
  { id: 'ach',    label: 'ACH / Bank Transfer' },
  { id: 'wire',   label: 'Wire Transfer' },
  { id: 'apple',  label: 'Apple Pay' },
  { id: 'google', label: 'Google Pay' },
];

// Per-processor colored badge (matches the spec color palette).
const PROC_BADGE_TONE = {
  authnet:      'info',     // blue
  stripe:       'accent',   // purple
  square:       'success',  // green
  paymentcloud: 'warning',  // orange
  nmi:          'neutral',
  paypal:       'info',
  manual:       'neutral',
};

function HealthDot({ status }) {
  const map = {
    healthy:      { icon: '🟢', label: 'Healthy', color: 'var(--success)' },
    slow:         { icon: '🟡', label: 'Slow',    color: 'var(--warning)' },
    error:        { icon: '🔴', label: 'Error',   color: 'var(--danger)' },
    unconfigured: { icon: '⚪', label: 'Unconfigured', color: 'var(--text-tertiary)' },
    unknown:      { icon: '⚫', label: 'Unknown', color: 'var(--text-tertiary)' },
  };
  const m = map[status] || map.unknown;
  return <span style={{ color: m.color, fontWeight: 500 }}>{m.icon} {m.label}</span>;
}

export default function Merchants() {
  const { user: me } = useAuth();
  const isSuper = ['super_admin', 'owner'].includes(me?.role);
  const [rows, setRows] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [m, e] = await Promise.all([
        api.get('/api/merchants'),
        entities.length ? Promise.resolve({ rows: entities }) : api.get('/api/entities'),
      ]);
      setRows(m.rows);
      if (!entities.length) setEntities(e.rows);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function runHealth(row) {
    try {
      const r = await api.post(`/api/merchants/${row.id}/health-check`, {});
      const isErr = r.status === 'error';
      toast[isErr ? 'error' : 'success'](`${row.processor_name}: ${r.message || r.status}`);
      load();
    } catch (e) { toast.error(e.message); }
  }

  async function doDelete() {
    try {
      await api.delete(`/api/merchants/${confirmDelete.id}`);
      toast.success('Merchant removed');
      setConfirmDelete(null);
      load();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Merchants"
        subtitle={`${rows.length} merchants · ${rows.filter((r) => r.is_live).length} live · ${rows.filter((r) => r.health_status === 'healthy').length} healthy`}
        actions={isSuper && <Button onClick={() => setOpenForm(true)}><Plus size={14} /> Add Merchant</Button>}
      />

      {err && <Alert tone="error" className="mb-4">{err}</Alert>}

      {loading && <Card className="p-6" style={{ color: 'var(--text-secondary)' }}>Loading…</Card>}

      {!loading && rows.length === 0 && (
        <Card className="p-12" style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>No merchants yet</div>
          {isSuper && <Button onClick={() => setOpenForm(true)}><Plus size={14} /> Add first merchant</Button>}
        </Card>
      )}

      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((r) => (
            <MerchantCard
              key={r.id}
              row={r}
              isSuper={isSuper}
              onTest={() => runHealth(r)}
              onEdit={() => setEditing(r)}
              onDelete={() => setConfirmDelete(r)}
            />
          ))}
        </div>
      )}

      {(openForm || editing) && (
        <MerchantForm
          merchant={editing}
          entities={entities}
          onClose={() => { setOpenForm(false); setEditing(null); }}
          onSaved={() => { setOpenForm(false); setEditing(null); load(); }}
        />
      )}

      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(null)} title="Remove merchant?"
          footer={<>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={doDelete}>Remove</Button>
          </>}>
          <p>Soft-delete <strong>{confirmDelete.processor_name}</strong>? Blocks if it has active transactions in the last 30 days.</p>
        </Modal>
      )}
    </div>
  );
}

function MerchantCard({ row, isSuper, onTest, onEdit, onDelete }) {
  const proc = PROCESSORS.find((p) => p.id === row.processor_type)?.label || row.processor_type || '—';
  const checked = row.health_checked_at
    ? new Date(row.health_checked_at).toLocaleString()
    : 'never';
  const methods = (() => {
    const j = row.supported_methods_json;
    if (Array.isArray(j)) return j;
    if (typeof j === 'string') { try { return JSON.parse(j); } catch { return []; } }
    return Array.isArray(row.supported_methods) ? row.supported_methods : [];
  })();
  const cap = parseFloat(row.monthly_volume_cap) || 0;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3 mb-3">
        {row.logo_url
          ? <img src={row.logo_url} alt={row.processor_name}
              style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'contain', background: 'var(--bg-tertiary)', padding: 6, border: '1px solid var(--border)' }} />
          : <div style={{ width: 56, height: 56, borderRadius: 10, background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 }}>{(row.processor_name || '?').charAt(0)}</div>
        }
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }} className="truncate">{row.processor_name}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge tone={PROC_BADGE_TONE[row.processor_type] || 'neutral'}>{proc}</Badge>
            {row.is_sandbox && <Badge tone="warning">Sandbox</Badge>}
            {row.is_live ? <Badge tone="success">Live</Badge> : <Badge tone="zinc">Inactive</Badge>}
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 6 }}>
        <div style={{ fontSize: 13 }}><HealthDot status={row.health_status} /></div>
        {row.health_message && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{row.health_message.slice(0, 120)}</div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Last checked: {checked}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Volume cap</div>
          <div>{cap > 0 ? money(cap) + '/mo' : 'Unlimited'}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Methods</div>
          <div>{methods.length ? methods.map((m) => (METHODS.find((x) => x.id === m)?.label || m).split(' ')[0]).join(', ') : '—'}</div>
        </div>
      </div>

      {isSuper && (
        <div className="flex gap-2 mt-3">
          <Button variant="secondary" size="sm" onClick={onTest}><RefreshCw size={12} /> Test</Button>
          <Button variant="ghost" size="sm" onClick={onEdit}><Edit2 size={12} /> Edit</Button>
          <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 size={12} /> Delete</Button>
        </div>
      )}
    </Card>
  );
}

function MerchantForm({ merchant, entities, onClose, onSaved }) {
  const isEdit = !!merchant;
  const [form, setForm] = useState(() => merchant ? {
    ...merchant,
    api_credentials: typeof merchant.api_credentials === 'object' ? merchant.api_credentials : {},
    supported_methods_json: (() => {
      const j = merchant.supported_methods_json;
      if (Array.isArray(j)) return j;
      if (typeof j === 'string') { try { return JSON.parse(j); } catch { return ['cards']; } }
      return ['cards'];
    })(),
  } : {
    processor_name: '',
    processor_type: 'authnet',
    contact_name: '', contact_email: '', contact_phone: '',
    notes: '',
    is_sandbox: false,
    monthly_volume_cap: 0,
    supported_methods_json: ['cards'],
    api_credentials: {},
    entity_id: '',
  });
  const [showCreds, setShowCreds] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function setCred(k, v) { setForm((f) => ({ ...f, api_credentials: { ...(f.api_credentials || {}), [k]: v } })); }
  function toggleMethod(id) {
    setForm((f) => {
      const cur = f.supported_methods_json || [];
      return { ...f, supported_methods_json: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  }

  const credFields = CRED_FIELDS[form.processor_type] || [];

  async function testConnection() {
    if (!isEdit) {
      setTestResult({ status: 'info', message: 'Save first, then test from the merchant card.' });
      return;
    }
    setTesting(true); setTestResult(null);
    try {
      const r = await api.post(`/api/merchants/${merchant.id}/health-check`, {});
      setTestResult(r);
    } catch (e) { setTestResult({ status: 'error', message: e.message }); }
    finally { setTesting(false); }
  }

  async function uploadLogo(merchantId) {
    if (!logoFile) return;
    const fd = new FormData();
    fd.append('logo', logoFile);
    const token = localStorage.getItem('foundapay_token');
    const res = await fetch(`/api/merchants/${merchantId}/logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Logo upload failed');
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = {
        processor_name: form.processor_name,
        processor_type: form.processor_type,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        notes: form.notes || null,
        is_sandbox: !!form.is_sandbox,
        monthly_volume_cap: parseFloat(form.monthly_volume_cap) || 0,
        supported_methods_json: form.supported_methods_json,
        api_credentials: form.api_credentials || {},
        entity_id: form.entity_id || null,
      };
      let saved;
      if (isEdit) {
        saved = await api.put(`/api/merchants/${merchant.id}`, body);
        if (logoFile) await uploadLogo(merchant.id);
      } else {
        saved = await api.post('/api/merchants', body);
        if (logoFile && saved?.merchant?.id) await uploadLogo(saved.merchant.id);
      }
      toast.success(`${isEdit ? 'Updated' : 'Created'} ${body.processor_name}`);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const testPassed = testResult?.status === 'healthy' || testResult?.status === 'slow';

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${merchant.processor_name}` : 'Add merchant'} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} variant={testPassed ? 'success' : 'primary'}>
          {saving ? 'Saving…' : (testPassed ? 'Save & Activate' : (isEdit ? 'Save' : 'Save Anyway'))}
        </Button>
      </>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}

      <Section title="Basic info">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Merchant name *</Label>
            <Input value={form.processor_name} onChange={(e) => setField('processor_name', e.target.value)} required />
          </div>
          <div><Label>Processor type *</Label>
            <Select value={form.processor_type} onChange={(e) => { setField('processor_type', e.target.value); setForm((f) => ({ ...f, api_credentials: {} })); }}>
              {PROCESSORS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
          </div>
          <div><Label>Entity</Label>
            <Select value={form.entity_id || ''} onChange={(e) => setField('entity_id', e.target.value || null)}>
              <option value="">— None —</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
            </Select>
          </div>
          <div><Label>Contact name</Label>
            <Input value={form.contact_name || ''} onChange={(e) => setField('contact_name', e.target.value)} />
          </div>
          <div><Label>Contact email</Label>
            <Input type="email" value={form.contact_email || ''} onChange={(e) => setField('contact_email', e.target.value)} />
          </div>
          <div><Label>Contact phone</Label>
            <Input value={form.contact_phone || ''} onChange={(e) => setField('contact_phone', e.target.value)} />
          </div>
          <div className="col-span-2"><Label>Notes</Label>
            <Textarea rows="2" value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)} />
          </div>
        </div>
      </Section>

      <Section title="Logo">
        <div className="flex items-start gap-3">
          {(logoFile || form.logo_url) ? (
            <img src={logoFile ? URL.createObjectURL(logoFile) : form.logo_url}
              alt="logo" style={{ width: 60, height: 60, borderRadius: 10, objectFit: 'contain', background: 'var(--bg-tertiary)', padding: 6, border: '1px solid var(--border)' }} />
          ) : (
            <div style={{ width: 60, height: 60, borderRadius: 10, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 11, border: '1px dashed var(--border)' }}>No logo</div>
          )}
          <div className="flex-1">
            <label className="fp-btn fp-btn-secondary" style={{ cursor: 'pointer' }}>
              <Upload size={12} /> {logoFile ? `Selected: ${logoFile.name}` : 'Upload logo'}
              <input type="file" accept="image/png,image/jpeg,image/jpg,image/svg+xml" hidden
                onChange={(e) => setLogoFile(e.target.files[0] || null)} />
            </label>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
              PNG / JPG / SVG · max 2MB · shown on payment pages, invoices, receipts
            </div>
          </div>
        </div>
      </Section>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>API Credentials</span>
          <button onClick={() => setShowCreds((s) => !s)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer' }}>
            {showCreds ? '▾ Hide' : '▸ Show'}
          </button>
        </div>
        {showCreds && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {credFields.map((f) => (
                <div key={f.key} className={f.textarea ? 'col-span-2' : ''}>
                  <Label>{f.label}{f.secret && <span style={{ marginLeft: 6, color: 'var(--text-tertiary)', textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 10 }}>(secret)</span>}</Label>
                  {f.textarea ? (
                    <Textarea rows="3" value={form.api_credentials?.[f.key] || ''}
                      onChange={(e) => setCred(f.key, e.target.value)} />
                  ) : (
                    <Input
                      type={f.secret && !showSecrets ? 'password' : 'text'}
                      value={form.api_credentials?.[f.key] || ''}
                      onChange={(e) => setCred(f.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
            {credFields.some((f) => f.secret) && (
              <button onClick={() => setShowSecrets((s) => !s)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, marginTop: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {showSecrets ? <><EyeOff size={11} /> Hide secrets</> : <><Eye size={11} /> Show secrets</>}
              </button>
            )}
            {form.processor_type !== 'manual' && (
              <div className="mt-3">
                <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.is_sandbox}
                    onChange={(e) => setField('is_sandbox', e.target.checked)} />
                  Sandbox mode
                </label>
              </div>
            )}
          </>
        )}
      </div>

      <Section title="Settings">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Monthly volume cap (0 = unlimited)</Label>
            <Input type="number" step="0.01" value={form.monthly_volume_cap || 0}
              onChange={(e) => setField('monthly_volume_cap', e.target.value)} />
          </div>
        </div>
        <div className="mt-3">
          <Label>Supported methods</Label>
          <div className="flex flex-wrap gap-2">
            {METHODS.map((m) => {
              const active = (form.supported_methods_json || []).includes(m.id);
              return (
                <button key={m.id} type="button" onClick={() => toggleMethod(m.id)}
                  style={{
                    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}>
                  {active ? '☑' : '☐'} {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title="Test connection">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="secondary" onClick={testConnection} disabled={testing || !isEdit}>
            <Activity size={12} /> {testing ? 'Testing…' : '🔌 Test connection'}
          </Button>
          {!isEdit && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Save first; then test from the card.</span>}
          {testResult && (
            <span style={{ fontSize: 12, color: testResult.status === 'error' ? 'var(--danger)' : (testPassed ? 'var(--success)' : 'var(--text-secondary)') }}>
              {testResult.status === 'healthy' && '✅ '}
              {testResult.status === 'error' && '❌ '}
              {testResult.message || testResult.status}
              {testResult.latency != null && ` (${testResult.latency}ms)`}
            </span>
          )}
        </div>
      </Section>
    </Modal>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
