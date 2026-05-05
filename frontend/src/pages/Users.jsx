import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge, Table, Thead, Th, Tr, Td, dateOnly } from '../components/ui';

const ROLES = ['super_admin','owner','admin','finance_manager','operations_manager','accountant','remote_operator','client_user','entity_owner','auditor'];

export default function Users() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [tempPass, setTempPass] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [u, c] = await Promise.all([api.get('/api/users'), api.get('/api/clients')]);
      setRows(u.rows); setClients(c.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader title="Users & Roles" actions={<Button onClick={() => setCreateOpen(true)}>+ New user</Button>} />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      {tempPass && <Alert tone="success" className="mb-4">User created. Temporary password: <span className="font-mono">{tempPass}</span> (also emailed if MAIL_USER set)</Alert>}

      <Card className="overflow-hidden">
        <Table>
          <Thead><Tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Client</Th><Th>Last login</Th><Th>Logins</Th><Th>Active</Th><Th></Th></Tr></Thead>
          <tbody>
            {rows.map(u => (
              <Tr key={u.id}>
                <Td className="font-medium">{u.name || '—'}</Td>
                <Td className="text-[var(--text-secondary)] font-mono text-xs">{u.email}</Td>
                <Td><Badge tone={u.role === 'client_user' ? 'blue' : u.role.includes('admin') ? 'violet' : 'zinc'}>{u.role}</Badge></Td>
                <Td>{u.client_name || '—'}</Td>
                <Td className="text-[var(--text-tertiary)] text-xs">{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</Td>
                <Td className="text-[var(--text-secondary)]">{u.login_count || 0}</Td>
                <Td><Badge tone={u.is_active ? 'green' : 'red'}>{u.is_active ? 'yes' : 'no'}</Badge></Td>
                <Td><button className="text-[var(--accent)] text-xs" onClick={() => setEdit(u)}>Edit</button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {(createOpen || edit) && <UserForm user={edit} clients={clients}
        onClose={() => { setEdit(null); setCreateOpen(false); }}
        onSaved={(tp) => { setTempPass(tp || null); setEdit(null); setCreateOpen(false); load(); }} />}
    </div>
  );
}

function UserForm({ user, clients, onClose, onSaved }) {
  const [form, setForm] = useState(user || { role: 'admin', is_active: true });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      if (user) {
        await api.patch(`/api/users/${user.id}`, form);
        onSaved(null);
      } else {
        const r = await api.post('/api/users', form);
        onSaved(r.temp_password);
      }
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.email}` : 'New user'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}
    >
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Email</Label><Input type="email" value={form.email || ''} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} required /></div>
        <div><Label>Name</Label><Input value={form.name || ''} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div><Label>Role</Label><Select value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}>{ROLES.map(r => <option key={r}>{r}</option>)}</Select></div>
        {form.role === 'client_user' && (
          <div className="col-span-2"><Label>Linked client (required)</Label><Select value={form.client_id || ''} onChange={(e) => setForm(f => ({ ...f, client_id: e.target.value }))}><option value="">— Select —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        )}
        <div><Label>Phone</Label><Input value={form.phone || ''} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
        <div className="flex items-center"><label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mt-5"><input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm(f => ({ ...f, is_active: e.target.checked }))} />Active</label></div>
        {!user && <div className="col-span-2 text-xs text-[var(--text-tertiary)]">Leave password blank to auto-generate and email a temporary password.</div>}
      </div>
    </Modal>
  );
}
