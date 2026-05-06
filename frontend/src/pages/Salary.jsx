import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Plus, MoreVertical, Edit2, Wallet, History, Trash2, X, Download, CheckCircle2 } from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Textarea, Label, PageHeader, Alert, Badge, Modal,
  Table, Thead, Th, Tr, Td, money, dateOnly,
} from '../components/ui';
import { toast } from '../store/toast';

export default function Salary() {
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [details, setDetails] = useState(null);
  const [err, setErr] = useState(null);

  const [editFx, setEditFx] = useState(false);
  const [fxValue, setFxValue] = useState('');

  const [editingItem, setEditingItem] = useState(null); // existing item
  const [addingItem, setAddingItem] = useState(false);  // new
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmMarkAll, setConfirmMarkAll] = useState(false);

  async function loadList() {
    try {
      const r = await api.get('/api/salary');
      setList(r.rows);
      if (r.rows.length && !active) setActive(r.rows[0].id);
    } catch (e) { setErr(e.message); }
  }
  async function loadDetails(id) {
    if (!id) return;
    try {
      const r = await api.get(`/api/salary/${id}`);
      setDetails(r);
      setFxValue(String(r.disbursement.exchange_rate || ''));
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { loadList(); }, []);
  useEffect(() => { loadDetails(active); /* eslint-disable-next-line */ }, [active]);

  async function approve() { await api.patch(`/api/salary/${active}/approve`, {}); loadDetails(active); loadList(); }
  async function markDisbursed() { await api.patch(`/api/salary/${active}/mark-disbursed`, {}); loadDetails(active); loadList(); }
  async function markItemPaid(itemId) { await api.patch(`/api/salary/${active}/items/${itemId}/paid`, {}); loadDetails(active); }

  async function saveFx() {
    try {
      await api.patch(`/api/salary/${active}`, { exchange_rate: parseFloat(fxValue) || 0 });
      toast.success('FX rate saved — PKR amounts recalculated');
      setEditFx(false);
      loadDetails(active);
      loadList();
    } catch (e) { toast.error(e.message); }
  }

  async function markAllPaid() {
    try {
      const r = await api.patch(`/api/salary/${active}/mark-all-paid`, {});
      toast.success(`Marked ${r.marked} item${r.marked === 1 ? '' : 's'} paid`);
      setConfirmMarkAll(false);
      loadDetails(active);
    } catch (e) { toast.error(e.message); }
  }

  async function removeItem() {
    try {
      await api.delete(`/api/salary/${active}/items/${confirmRemove.id}`);
      toast.success('Removed from payroll');
      setConfirmRemove(null);
      loadDetails(active);
      loadList();
    } catch (e) { toast.error(e.message); }
  }

  function exportCsv() {
    if (!details) return;
    const rows = details.items;
    const header = ['Employee', 'Legal Name', 'Bank', 'Account', 'USD', 'PKR', 'Status', 'Active', 'Notes'];
    const csv = [header.join(',')]
      .concat(rows.map((r) => [
        r.employee_name, r.full_name, r.bank_name, r.account_number,
        r.amount_usd, r.amount_pkr, r.status,
        r.is_active === false ? 'No' : 'Yes',
        (r.notes || '').replace(/"/g, '""'),
      ].map((v) => `"${(v == null ? '' : String(v)).replace(/"/g, '""')}"`).join(',')))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `payroll-${details.disbursement.period}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const pendingCount = (details?.items || []).filter((i) => i.status !== 'paid').length;

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Payroll"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={exportCsv} disabled={!details}><Download size={14} /> Export CSV</Button>
            {details && <Button onClick={() => setAddingItem(true)}><Plus size={14} /> Add Employee</Button>}
          </div>
        }
      />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-3">
          <h3 className="font-medium text-[var(--text-primary)] mb-2 text-sm">Disbursements</h3>
          <div className="space-y-1">
            {list.map((d) => (
              <button
                key={d.id}
                onClick={() => setActive(d.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm ${active === d.id ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
              >
                <div className="font-medium">{d.period}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{money(d.total_usd)} · {d.items_count} payees</div>
                <Badge tone={d.status === 'disbursed' ? 'green' : d.status === 'approved' ? 'blue' : 'zinc'} className="mt-1">{d.status}</Badge>
              </button>
            ))}
          </div>
        </Card>

        <div className="md:col-span-3 space-y-4">
          {!details && <Card className="p-6 text-[var(--text-tertiary)]">Pick a disbursement…</Card>}
          {details && (
            <>
              <Card className="p-5">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">{details.disbursement.period}</h2>
                    <div className="text-[var(--text-tertiary)] text-sm">Pay date: {dateOnly(details.disbursement.pay_date)}</div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {pendingCount > 0 && <Button variant="secondary" onClick={() => setConfirmMarkAll(true)}><CheckCircle2 size={14} /> Mark All Paid</Button>}
                    {details.disbursement.status === 'draft' && <Button onClick={approve}>Approve</Button>}
                    {details.disbursement.status === 'approved' && <Button onClick={markDisbursed}>Mark Disbursed</Button>}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <Stat label="Total USD" value={money(details.disbursement.total_usd)} tone="green" />
                  <Stat label="Total PKR" value={money(details.disbursement.total_pkr, 'PKR')} />
                  <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">FX rate</div>
                      {editFx ? (
                        <div className="flex gap-2 mt-1">
                          <input
                            value={fxValue}
                            onChange={(e) => setFxValue(e.target.value)}
                            className="fp-input"
                            style={{ width: 90, height: 28, fontSize: 13 }}
                            type="number" step="0.01"
                          />
                          <Button size="sm" onClick={saveFx}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditFx(false); setFxValue(String(details.disbursement.exchange_rate)); }}>X</Button>
                        </div>
                      ) : (
                        <div className="text-base font-semibold text-[var(--text-primary)]">
                          {details.disbursement.exchange_rate} PKR / USD
                        </div>
                      )}
                    </div>
                    {!editFx && (
                      <button onClick={() => setEditFx(true)} title="Edit FX rate"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4 }}>
                        <Pencil size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="overflow-visible">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Employee</Th>
                      <Th>Bank</Th>
                      <Th>Account</Th>
                      <Th className="text-right">USD</Th>
                      <Th className="text-right">PKR</Th>
                      <Th>Status</Th>
                      <Th>Active</Th>
                      <Th style={{ width: 56 }}></Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {details.items.map((it) => (
                      <Tr key={it.id}>
                        <Td className="font-medium">
                          {it.employee_name}
                          <div className="text-xs text-[var(--text-tertiary)]">{it.full_name}</div>
                        </Td>
                        <Td className="text-[var(--text-secondary)]">{it.bank_name}</Td>
                        <Td className="text-[var(--text-tertiary)] font-mono text-xs">{it.account_number}</Td>
                        <Td className="text-right font-mono">{money(it.amount_usd)}</Td>
                        <Td className="text-right font-mono">{money(it.amount_pkr, 'PKR')}</Td>
                        <Td><Badge tone={it.status === 'paid' ? 'green' : 'zinc'}>{it.status}</Badge></Td>
                        <Td>{it.is_active === false ? <Badge tone="zinc">Inactive</Badge> : <Badge tone="blue">Active</Badge>}</Td>
                        <Td>
                          <ItemKebab
                            it={it}
                            onEdit={() => setEditingItem(it)}
                            onMarkPaid={() => markItemPaid(it.id)}
                            onRemove={() => setConfirmRemove(it)}
                          />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </>
          )}
        </div>
      </div>

      {(editingItem || addingItem) && (
        <ItemForm
          item={editingItem}
          rate={parseFloat(details?.disbursement?.exchange_rate) || 280}
          onClose={() => { setEditingItem(null); setAddingItem(false); }}
          onSave={async (body) => {
            try {
              if (editingItem) {
                await api.patch(`/api/salary/${active}/items/${editingItem.id}`, body);
                toast.success('Employee updated');
              } else {
                await api.post(`/api/salary/${active}/items`, body);
                toast.success('Employee added');
              }
              setEditingItem(null); setAddingItem(false);
              loadDetails(active); loadList();
            } catch (e) { toast.error(e.message); throw e; }
          }}
        />
      )}

      {confirmRemove && (
        <Modal open onClose={() => setConfirmRemove(null)} title="Remove from payroll?"
          footer={<>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>Cancel</Button>
            <Button variant="danger" onClick={removeItem}>Remove</Button>
          </>}>
          <p>Remove <strong>{confirmRemove.employee_name}</strong> ({money(confirmRemove.amount_usd)}) from this payroll cycle?</p>
        </Modal>
      )}

      {confirmMarkAll && (
        <Modal open onClose={() => setConfirmMarkAll(false)} title="Mark all pending as paid?"
          footer={<>
            <Button variant="ghost" onClick={() => setConfirmMarkAll(false)}>Cancel</Button>
            <Button variant="success" onClick={markAllPaid}>Mark all paid</Button>
          </>}>
          <p>This will mark all <strong>{pendingCount}</strong> pending payees as paid.</p>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'zinc' }) {
  const tones = { zinc: 'text-[var(--text-primary)]', green: 'text-emerald-400', amber: 'text-amber-400' };
  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{label}</div>
      <div className={`text-base font-semibold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

function ItemKebab({ it, onEdit, onMarkPaid, onRemove }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    function place() {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuH = menuRef.current?.offsetHeight || 200;
      let top = rect.bottom + 6;
      if (top + menuH > window.innerHeight - 12) top = Math.max(12, rect.top - menuH - 6);
      let left = rect.right - 220;
      if (left < 12) left = 12;
      setPos({ top, left });
    }
    place();
    const raf = requestAnimationFrame(place);
    function close() { setOpen(false); }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', close, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', place); window.removeEventListener('scroll', close, true); };
  }, [open]);

  useEffect(() => {
    function onDocClick(e) {
      if (btnRef.current && !btnRef.current.contains(e.target) &&
          menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen((o) => !o)}
        style={{ background: open ? 'var(--bg-hover)' : 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: 'var(--text-secondary)' }}>
        <MoreVertical size={16} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="fp-slide-up" style={{
          position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999,
          width: 220, padding: 4, zIndex: 1000,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          visibility: pos ? 'visible' : 'hidden',
        }}>
          <KebabItem icon={Edit2} onClick={() => { setOpen(false); onEdit(); }}>Edit Employee</KebabItem>
          {it.status !== 'paid' && (
            <KebabItem icon={CheckCircle2} tone="success" onClick={() => { setOpen(false); onMarkPaid(); }}>Mark Paid</KebabItem>
          )}
          <KebabDivider />
          <KebabItem icon={Trash2} tone="danger" onClick={() => { setOpen(false); onRemove(); }}>Remove from Payroll</KebabItem>
        </div>,
        document.body,
      )}
    </>
  );
}
function KebabItem({ icon: Icon, onClick, children, tone }) {
  const colors = { success: 'var(--success)', danger: 'var(--danger)' };
  return (
    <button onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px',
               background: 'transparent', border: 'none', color: colors[tone] || 'var(--text-primary)',
               fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left', borderRadius: 6 }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <Icon size={14} /> {children}
    </button>
  );
}
function KebabDivider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />;
}

function ItemForm({ item, rate, onClose, onSave }) {
  const [form, setForm] = useState(() => item ? { ...item } : {
    employee_name: '', full_name: '', bank_name: '', account_number: '',
    amount_usd: 0, amount_pkr: 0, is_active: true, notes: '',
  });
  const [pkrTouched, setPkrTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  // Auto-derive PKR from USD × rate unless user manually edited PKR
  useEffect(() => {
    if (pkrTouched) return;
    const u = parseFloat(form.amount_usd) || 0;
    setForm((f) => ({ ...f, amount_pkr: +(u * rate).toFixed(2) }));
  // eslint-disable-next-line
  }, [form.amount_usd, rate]);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = {
        employee_name: form.employee_name,
        full_name: form.full_name || null,
        bank_name: form.bank_name || null,
        account_number: form.account_number || null,
        amount_usd: parseFloat(form.amount_usd) || 0,
        amount_pkr: parseFloat(form.amount_pkr) || 0,
        is_active: form.is_active !== false,
        notes: form.notes || null,
      };
      await onSave(body);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={item ? `Edit ${item.employee_name}` : 'Add Employee'} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : (item ? 'Save Changes' : 'Add Employee')}</Button>
      </>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Employee name</Label>
          <Input value={form.employee_name} onChange={(e) => setField('employee_name', e.target.value)} required />
        </div>
        <div><Label>Legal / full name</Label>
          <Input value={form.full_name || ''} onChange={(e) => setField('full_name', e.target.value)} />
        </div>
        <div><Label>Bank name</Label>
          <Input value={form.bank_name || ''} onChange={(e) => setField('bank_name', e.target.value)} />
        </div>
        <div><Label>Account number</Label>
          <Input value={form.account_number || ''} onChange={(e) => setField('account_number', e.target.value)} />
        </div>
        <div><Label>USD amount</Label>
          <Input type="number" step="0.01" value={form.amount_usd ?? 0} onChange={(e) => setField('amount_usd', e.target.value)} />
        </div>
        <div>
          <Label>PKR amount <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'none', letterSpacing: 0 }}>
            (auto from rate {rate}, override below)
          </span></Label>
          <Input type="number" step="0.01" value={form.amount_pkr ?? 0}
            onChange={(e) => { setPkrTouched(true); setField('amount_pkr', e.target.value); }} />
        </div>
        <div><Label>Status</Label>
          <Select value={form.is_active === false ? 'inactive' : 'active'} onChange={(e) => setField('is_active', e.target.value === 'active')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
        <div className="col-span-2"><Label>Notes</Label>
          <Textarea rows="2" value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
