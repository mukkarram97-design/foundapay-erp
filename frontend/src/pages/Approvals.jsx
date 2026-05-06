import React, { useEffect, useState } from 'react';
import {
  CheckCircle2, XCircle, Upload, Eye, Clock, FileText, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Textarea, Select, Label, PageHeader, Alert, Badge, Modal,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';

const TYPE_LABEL = {
  payout_request:   'Payout',
  refund_request:   'Refund',
  void_request:     'Void',
  expense_approval: 'Expense',
};

const STATUS_DISPLAY = {
  pending:          { label: '⏳ Pending Admin', tone: 'warning' },
  admin_approved:   { label: '✅ Admin OK · awaiting Super', tone: 'info' },
  super_approved:   { label: '✅✅ Super OK · upload proof', tone: 'info' },
  proof_uploaded:   { label: '📎 Proof uploaded · ready', tone: 'accent' },
  completed:        { label: '✅ Completed', tone: 'success' },
  rejected:         { label: '❌ Rejected', tone: 'danger' },
};

export default function Approvals() {
  const { user: me } = useAuth();
  const isAdmin = ['super_admin', 'owner', 'admin'].includes(me?.role);
  const isSuper = ['super_admin', 'owner'].includes(me?.role);

  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [openDetail, setOpenDetail] = useState(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const params = new URLSearchParams();
      if (tab === 'pending') {
        // pending = anything not yet completed/rejected
      } else if (tab === 'mine') {
        // server filters by role; client-side post-filter ensures requester=me
      } else if (tab === 'all') {
        // no filter
      } else {
        params.set('status', tab);
      }
      const r = await api.get(`/api/approvals?${params.toString()}`);
      let list = r.rows || [];
      if (tab === 'mine') list = list.filter((x) => x.requested_by === me?.id);
      if (tab === 'pending') list = list.filter((x) => !['completed', 'rejected'].includes(x.status));
      setRows(list);
      setSummary(r.summary || {});
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  const tabs = [
    { id: 'pending', label: 'Pending', tone: 'warning' },
    { id: 'mine',    label: 'My requests' },
    ...(isSuper ? [{ id: 'all', label: 'All' }] : []),
  ];

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Approvals"
        subtitle={`${summary.pending_count ?? 0} pending · ${summary.awaiting_super_count ?? 0} awaiting super · ${summary.ready_to_complete_count ?? 0} ready to complete`}
      />

      {err && <Alert tone="error" className="mb-4">{err}</Alert>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Stat label="Pending" value={summary.pending_count ?? 0} tone="warning" />
        <Stat label="Awaiting super" value={summary.awaiting_super_count ?? 0} tone="info" />
        <Stat label="Ready to complete" value={summary.ready_to_complete_count ?? 0} tone="accent" />
        <Stat label="Completed" value={summary.completed_count ?? 0} tone="success" />
        <Stat label="Rejected" value={summary.rejected_count ?? 0} tone="danger" />
      </div>

      <Card className="p-2 mb-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '6px 14px', borderRadius: 8, border: 'none',
                background: tab === t.id ? 'var(--bg-hover)' : 'transparent',
                color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}>{t.label}</button>
          ))}
        </div>
      </Card>

      <Card>
        <Table>
          <Thead>
            <Tr>
              <Th>Type</Th>
              <Th>Reference</Th>
              <Th className="text-right">Amount</Th>
              <Th>Requested by</Th>
              <Th>Requested</Th>
              <Th>Status</Th>
              <Th>Proof</Th>
              <Th style={{ width: 200 }}>Actions</Th>
            </Tr>
          </Thead>
          <tbody>
            {loading && <Tr><Td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</Td></Tr>}
            {!loading && rows.length === 0 && (
              <Tr><Td colSpan="8" style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                No approval requests {tab !== 'all' && 'in this view'}.
              </Td></Tr>
            )}
            {!loading && rows.map((r) => (
              <ApprovalRow
                key={r.id}
                row={r}
                isAdmin={isAdmin} isSuper={isSuper} myId={me?.id}
                onOpen={() => setOpenDetail(r)}
              />
            ))}
          </tbody>
        </Table>
      </Card>

      {openDetail && (
        <ApprovalDetail
          id={openDetail.id}
          isAdmin={isAdmin} isSuper={isSuper} myId={me?.id}
          onClose={() => setOpenDetail(null)}
          onChanged={() => { setOpenDetail(null); load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  const colors = { success: 'var(--success)', warning: 'var(--warning)', accent: 'var(--accent)', danger: 'var(--danger)', info: 'var(--info)' };
  return (
    <Card className="p-4">
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: colors[tone] || 'var(--text-primary)' }}>{value}</div>
    </Card>
  );
}

function ApprovalRow({ row, isAdmin, isSuper, myId, onOpen }) {
  const sd = STATUS_DISPLAY[row.status] || { label: row.status, tone: 'neutral' };
  const isOwner = row.requested_by === myId;
  return (
    <Tr clickable onClick={onOpen}>
      <Td><Badge tone="info">{TYPE_LABEL[row.type] || row.type}</Badge></Td>
      <Td className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {row.reference_type ? `${row.reference_type} #${row.reference_id || '—'}` : '—'}
      </Td>
      <Td className="text-right font-mono">{row.amount != null ? money(row.amount) : '—'}</Td>
      <Td>
        <div style={{ fontSize: 12 }}>{row.requested_by_name || '—'}</div>
        {row.requested_by_email && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{row.requested_by_email}</div>}
      </Td>
      <Td className="text-xs">{dateOnly(row.requested_at)}</Td>
      <Td><Badge tone={sd.tone}>{sd.label}</Badge></Td>
      <Td>{row.proof_url ? <a href={row.proof_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)', fontSize: 12 }}>View</a> : '—'}</Td>
      <Td onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1 flex-wrap">
          <Button size="sm" variant="secondary" onClick={onOpen}><Eye size={12} /> Review</Button>
        </div>
      </Td>
    </Tr>
  );
}

// ━━━ Detail modal — shows everything + decision panels ━━━
function ApprovalDetail({ id, isAdmin, isSuper, myId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [superNotes, setSuperNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [proofFile, setProofFile] = useState(null);

  async function load() {
    try {
      const r = await api.get(`/api/approvals/${id}`);
      setData(r);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!data) return <Modal open onClose={onClose} title="Loading…"><div>Loading…</div></Modal>;
  const a = data.approval;
  const isOwner = a.requested_by === myId;
  const sd = STATUS_DISPLAY[a.status] || { label: a.status, tone: 'neutral' };

  async function call(fn) {
    setBusy(true); setErr(null);
    try { await fn(); await load(); onChanged(); }
    catch (e) { setErr(e.message); toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`${TYPE_LABEL[a.type] || a.type} request`} wide
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Status"><Badge tone={sd.tone}>{sd.label}</Badge></Field>
        <Field label="Amount" value={a.amount != null ? money(a.amount) : '—'} />
        <Field label="Reference" value={a.reference_type ? `${a.reference_type} #${a.reference_id || '—'}` : '—'} />
        <Field label="Requested by" value={`${a.requested_by_name || '—'} (${dateOnly(a.requested_at)})`} />
        {a.request_reason && <Field label="Reason" value={a.request_reason} wide />}
      </div>

      {data.reference && (
        <Card className="p-3 mb-3" style={{ background: 'var(--bg-tertiary)' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>Reference</div>
          <pre style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', margin: 0 }}>
            {JSON.stringify(data.reference, null, 2)}
          </pre>
        </Card>
      )}

      {/* Admin review */}
      <Section title="Admin review" done={!!a.admin_decision}>
        {a.admin_decision ? (
          <div>
            <Badge tone={a.admin_decision === 'approved' ? 'success' : 'danger'}>{a.admin_decision}</Badge>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>
              {a.admin_reviewed_by_name} · {dateOnly(a.admin_reviewed_at)}
            </span>
            {a.admin_notes && <div style={{ fontSize: 13, marginTop: 6 }}>{a.admin_notes}</div>}
          </div>
        ) : isAdmin && a.status === 'pending' ? (
          <>
            <Textarea rows="2" placeholder="Notes (optional)"
              value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
            <div className="flex gap-2 mt-2">
              <Button variant="success" disabled={busy}
                onClick={() => call(async () => { await api.post(`/api/approvals/${id}/admin-review`, { decision: 'approved', notes: adminNotes }); })}>
                <CheckCircle2 size={12} /> Approve
              </Button>
              <Button variant="danger" disabled={busy}
                onClick={() => call(async () => { await api.post(`/api/approvals/${id}/admin-review`, { decision: 'rejected', notes: adminNotes }); })}>
                <XCircle size={12} /> Reject
              </Button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Awaiting admin review</div>
        )}
      </Section>

      {/* Super review */}
      <Section title="Super admin review" done={!!a.super_decision}>
        {a.super_decision ? (
          <div>
            <Badge tone={a.super_decision === 'approved' ? 'success' : 'danger'}>{a.super_decision}</Badge>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>
              {a.super_reviewed_by_name} · {dateOnly(a.super_reviewed_at)}
            </span>
            {a.super_notes && <div style={{ fontSize: 13, marginTop: 6 }}>{a.super_notes}</div>}
          </div>
        ) : isSuper && a.status === 'admin_approved' ? (
          <>
            <Textarea rows="2" placeholder="Notes (optional)"
              value={superNotes} onChange={(e) => setSuperNotes(e.target.value)} />
            <div className="flex gap-2 mt-2">
              <Button variant="success" disabled={busy}
                onClick={() => call(async () => { await api.post(`/api/approvals/${id}/super-review`, { decision: 'approved', notes: superNotes }); })}>
                <CheckCircle2 size={12} /> Approve
              </Button>
              <Button variant="danger" disabled={busy}
                onClick={() => call(async () => { await api.post(`/api/approvals/${id}/super-review`, { decision: 'rejected', notes: superNotes }); })}>
                <XCircle size={12} /> Reject
              </Button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Awaiting super-admin review</div>
        )}
      </Section>

      {/* Proof upload */}
      <Section title="Proof of execution" done={!!a.proof_url}>
        {a.proof_url ? (
          <a href={a.proof_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 13 }}>
            <FileText size={14} /> View proof
          </a>
        ) : (isOwner || isAdmin) && a.status === 'super_approved' ? (
          <div>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setProofFile(e.target.files[0])} />
            <div className="mt-2">
              <Button disabled={busy || !proofFile}
                onClick={() => call(async () => {
                  const fd = new FormData(); fd.append('proof', proofFile);
                  const token = localStorage.getItem('foundapay_token');
                  const r = await fetch(`/api/approvals/${id}/upload-proof`, {
                    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
                  });
                  if (!r.ok) throw new Error((await r.json()).error || 'Upload failed');
                })}>
                <Upload size={12} /> Upload proof
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Awaiting super-admin approval before proof</div>
        )}
      </Section>

      {/* Complete */}
      <Section title="Complete" done={a.status === 'completed'}>
        {a.status === 'completed' ? (
          <div>
            <Badge tone="success">Completed</Badge>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>
              {a.completed_by_name} · {dateOnly(a.completed_at)}
            </span>
          </div>
        ) : isSuper && (a.status === 'proof_uploaded' || (a.type === 'expense_approval' && a.status === 'super_approved')) ? (
          <Button variant="success" disabled={busy}
            onClick={() => call(async () => {
              const r = await api.post(`/api/approvals/${id}/complete`, {});
              toast.success(`Completed: ${a.type}`);
              return r;
            })}>
            <ShieldCheck size={12} /> Complete & execute
          </Button>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Not ready to complete yet</div>
        )}
      </Section>
    </Modal>
  );
}

function Field({ label, value, children, wide }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 13, marginTop: 2 }}>{children || value || '—'}</div>
    </div>
  );
}
function Section({ title, children, done }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: done ? 'var(--success)' : 'var(--text-secondary)', marginBottom: 8 }}>
        {done && '✓ '}{title}
      </div>
      {children}
    </div>
  );
}
