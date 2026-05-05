import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreVertical, Edit2, Mail, UserX, UserCheck, Trash2, Plus, Search, AlertTriangle, X,
} from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, Button, Input, Select, Label, PageHeader, Modal, Alert, Badge,
  Table, Thead, Th, Tr, Td,
} from '../components/ui';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';

const ROLES = [
  'super_admin','owner','admin','finance_manager','operations_manager',
  'accountant','remote_operator','client_user','entity_owner','auditor',
];

export default function Users() {
  const { user: me } = useAuth();
  const isSuperAdmin = me?.role === 'super_admin';
  const isAdminOrSuper = ['super_admin', 'admin'].includes(me?.role);

  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [tempPass, setTempPass] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [u, c] = await Promise.all([api.get('/api/users'), api.get('/api/clients')]);
      setRows(u.rows); setClients(c.rows);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q) ||
      (u.client_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Users & Roles"
        subtitle={`${rows.length} users · ${rows.filter((u) => u.is_active).length} active`}
        actions={<Button onClick={() => setCreateOpen(true)}><Plus size={14} /> New user</Button>}
      />

      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      {tempPass && (
        <Alert tone="success" className="mb-4">
          <div>
            <strong>{tempPass.email}</strong> · temporary password generated:
            <span style={{
              fontFamily: 'ui-monospace, monospace', fontWeight: 600,
              background: 'var(--bg-tertiary)', padding: '2px 8px',
              borderRadius: 4, marginLeft: 8,
            }}>{tempPass.password}</span>
            <button onClick={() => setTempPass(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)', marginLeft: 12,
            }}><X size={12} /></button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
            Email also sent (or logged to console if SMTP not configured). Share this password securely.
          </div>
        </Alert>
      )}

      <Card className="p-3 mb-4">
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <Input
            placeholder="Search by name, email, role, or client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36 }}
          />
        </div>
      </Card>

      <Card style={{ overflow: 'visible' }}>
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Client</Th>
              <Th>Last login</Th>
              <Th>Logins</Th>
              <Th>Status</Th>
              <Th style={{ width: 56 }}></Th>
            </Tr>
          </Thead>
          <tbody>
            {filtered.length === 0 && (
              <Tr>
                <Td colSpan="8" style={{ textAlign: 'center', padding: '32px 16px' }}>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>No users found</div>
                  <Button onClick={() => setCreateOpen(true)}><Plus size={14} /> New user</Button>
                </Td>
              </Tr>
            )}
            {filtered.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                me={me}
                isSuperAdmin={isSuperAdmin}
                isAdminOrSuper={isAdminOrSuper}
                onEdit={() => setEdit(u)}
                onDelete={() => setConfirmDel(u)}
                onTempPass={(p) => setTempPass({ email: u.email, password: p })}
                onChange={load}
              />
            ))}
          </tbody>
        </Table>
      </Card>

      {(createOpen || edit) && (
        <UserForm
          user={edit}
          clients={clients}
          onClose={() => { setEdit(null); setCreateOpen(false); }}
          onSaved={(tp) => {
            if (tp) setTempPass({ email: edit?.email || 'new user', password: tp });
            setEdit(null); setCreateOpen(false); load();
          }}
        />
      )}

      {confirmDel && (
        <DeleteUserModal
          user={confirmDel}
          onClose={() => setConfirmDel(null)}
          onDeleted={() => { setConfirmDel(null); load(); }}
        />
      )}
    </div>
  );
}

// ━━━ Single row with kebab menu + status pill ─────────────
function UserRow({ u, me, isSuperAdmin, isAdminOrSuper, onEdit, onDelete, onTempPass, onChange }) {
  const isSelf = u.id === me?.id;
  const isTargetSuper = u.role === 'super_admin';
  const inactive = !u.is_active;
  const canToggle = isAdminOrSuper && !isSelf && !isTargetSuper;
  const canDelete = isSuperAdmin && !isSelf && !isTargetSuper;

  const rowStyle = inactive ? { opacity: 0.55 } : {};
  const nameStyle = inactive
    ? { textDecoration: 'line-through', color: 'var(--text-tertiary)' }
    : {};

  return (
    <Tr style={rowStyle}>
      <Td className="font-medium" style={nameStyle}>{u.name || '—'}</Td>
      <Td className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{u.email}</Td>
      <Td>
        <Badge tone={inactive ? 'neutral' : (u.role === 'client_user' ? 'info' : u.role.includes('admin') ? 'accent' : 'neutral')}>
          {u.role}
        </Badge>
      </Td>
      <Td>{u.client_name || '—'}</Td>
      <Td className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}
      </Td>
      <Td style={{ color: 'var(--text-secondary)' }}>{u.login_count || 0}</Td>
      <Td>
        <StatusPill u={u} canToggle={canToggle} onChange={onChange} />
      </Td>
      <Td onClick={(e) => e.stopPropagation()}>
        <KebabMenu
          u={u}
          isSelf={isSelf}
          canToggle={canToggle}
          canDelete={canDelete}
          onEdit={onEdit}
          onDelete={onDelete}
          onTempPass={onTempPass}
          onChange={onChange}
        />
      </Td>
    </Tr>
  );
}

// ━━━ Status pill — clickable to toggle ─────────────────────
const PILL_POP_WIDTH = 260;

function StatusPill({ u, canToggle, onChange }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    if (!confirming) { setPos(null); return; }
    function place() {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popH = popRef.current?.offsetHeight || 110;
      let top = rect.bottom + MENU_GAP;
      if (top + popH > window.innerHeight - VIEWPORT_PADDING) {
        top = Math.max(VIEWPORT_PADDING, rect.top - popH - MENU_GAP);
      }
      let left = rect.left;
      if (left + PILL_POP_WIDTH > window.innerWidth - VIEWPORT_PADDING) {
        left = window.innerWidth - PILL_POP_WIDTH - VIEWPORT_PADDING;
      }
      if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
      setPos({ top, left });
    }
    place();
    const raf = requestAnimationFrame(place);
    function close() { setConfirming(false); }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', close, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', close, true);
    };
  }, [confirming]);

  useEffect(() => {
    function onDocClick(e) {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        popRef.current && !popRef.current.contains(e.target)
      ) setConfirming(false);
    }
    function onKey(e) { if (e.key === 'Escape') setConfirming(false); }
    if (confirming) {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [confirming]);

  async function doToggle() {
    setBusy(true);
    try {
      const r = await api.patch(`/api/users/${u.id}/toggle-active`, {});
      toast.success(r.message);
      onChange?.();
      setConfirming(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  function clickPill() {
    if (!canToggle) return;
    if (u.is_active) setConfirming(true); // confirm before deactivating
    else doToggle(); // activating doesn't need confirmation
  }

  const pillBg = u.is_active ? 'var(--success-bg)' : 'var(--danger-bg)';
  const pillFg = u.is_active ? 'var(--success-fg)' : 'var(--danger-fg)';
  const pillCircle = u.is_active ? '●' : '○';
  const pillLabel = u.is_active ? 'Active' : 'Inactive';

  return (
    <>
      <button
        ref={btnRef}
        onClick={clickPill}
        disabled={!canToggle}
        title={canToggle ? (u.is_active ? 'Click to deactivate' : 'Click to activate') : undefined}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 10px', borderRadius: 999,
          fontSize: 11, fontWeight: 500,
          background: pillBg, color: pillFg,
          border: 'none',
          cursor: canToggle ? 'pointer' : 'default',
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>{pillCircle}</span> {pillLabel}
      </button>

      {confirming && createPortal(
        <div
          ref={popRef}
          className="fp-slide-up"
          role="dialog"
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: PILL_POP_WIDTH,
            padding: 12,
            zIndex: 1000,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.2)',
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
            Deactivate {u.name || u.email}?
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
            They won't be able to log in.
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={doToggle} disabled={busy}>
              {busy ? 'Working…' : 'Deactivate'}
            </Button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ━━━ Kebab menu — Edit / Resend / Toggle / Delete ─────────
// Renders the dropdown via a portal with fixed positioning so it escapes the
// table's overflow-x-auto clipping and any ancestor stacking contexts. Aligns
// to the right edge of the trigger and flips upward if it would clip the
// viewport bottom.
const MENU_WIDTH = 220;
const MENU_GAP = 6;
const VIEWPORT_PADDING = 12;

function KebabMenu({ u, isSelf, canToggle, canDelete, onEdit, onDelete, onTempPass, onChange }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  // Position the menu after open. useLayoutEffect avoids a one-frame flash at
  // the wrong coords. We measure the actual menu height to flip-up correctly.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    function place() {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuH = menuRef.current?.offsetHeight || 200;
      let top = rect.bottom + MENU_GAP;
      if (top + menuH > window.innerHeight - VIEWPORT_PADDING) {
        top = Math.max(VIEWPORT_PADDING, rect.top - menuH - MENU_GAP);
      }
      let left = rect.right - MENU_WIDTH;
      if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
      if (left + MENU_WIDTH > window.innerWidth - VIEWPORT_PADDING) {
        left = window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING;
      }
      setPos({ top, left });
    }
    place();
    // Re-measure once we have a real menu height (after first paint).
    const raf = requestAnimationFrame(place);
    function close() { setOpen(false); }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', close, true); // capture: catch nested scrollers
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  useEffect(() => {
    function onDocClick(e) {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function resendInvite() {
    setBusy('resend'); setOpen(false);
    try {
      const r = await api.post(`/api/users/${u.id}/resend-invite`, {});
      toast.success(r.message);
      if (r.temp_password) onTempPass?.(r.temp_password);
    } catch (e) {
      toast.error(e.message);
    } finally { setBusy(null); }
  }

  async function toggleActive() {
    setBusy('toggle'); setOpen(false);
    try {
      const r = await api.patch(`/api/users/${u.id}/toggle-active`, {});
      toast.success(r.message);
      onChange?.();
    } catch (e) {
      toast.error(e.message);
    } finally { setBusy(null); }
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        title="Actions"
        disabled={!!busy}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          background: open ? 'var(--bg-hover)' : 'transparent',
          border: 'none', cursor: 'pointer',
          padding: 6, borderRadius: 6,
          color: 'var(--text-secondary)',
          display: 'inline-flex',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        <MoreVertical size={16} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fp-slide-up"
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: MENU_WIDTH,
            padding: 4,
            zIndex: 1000,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.2)',
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          <MenuItem icon={Edit2} onClick={() => { setOpen(false); onEdit(); }}>
            Edit user
          </MenuItem>
          {!isSelf && (
            <MenuItem icon={Mail} onClick={resendInvite} disabled={!u.is_active}>
              Resend invite
            </MenuItem>
          )}
          {canToggle && (
            <>
              <MenuDivider />
              {u.is_active ? (
                <MenuItem icon={UserX} tone="warning" onClick={toggleActive}>
                  Deactivate
                </MenuItem>
              ) : (
                <MenuItem icon={UserCheck} tone="success" onClick={toggleActive}>
                  Activate
                </MenuItem>
              )}
            </>
          )}
          {canDelete && (
            <>
              <MenuDivider />
              <MenuItem icon={Trash2} tone="danger" onClick={() => { setOpen(false); onDelete(); }}>
                Delete user
              </MenuItem>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function MenuItem({ icon: Icon, onClick, children, tone, disabled }) {
  const colors = {
    warning: 'var(--warning)',
    success: 'var(--success)',
    danger:  'var(--danger)',
  };
  const color = disabled ? 'var(--text-tertiary)' : (colors[tone] || 'var(--text-primary)');
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '8px 10px',
        background: 'transparent', border: 'none',
        color, fontSize: 13, fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        textAlign: 'left',
        borderRadius: 6,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={14} /> {children}
    </button>
  );
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />;
}

// ━━━ Delete user modal — type-DELETE confirmation ─────────
function DeleteUserModal({ user, onClose, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const enabled = typed.trim() === 'DELETE' && !busy;

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      const r = await api.delete(`/api/users/${user.id}`);
      toast.success(r.message);
      onDeleted();
    } catch (e) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)',
        zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      className="fp-fade-in"
    >
      <div className="fp-card fp-slide-up" style={{ width: '100%', maxWidth: 480, padding: 0 }}>
        <header style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '18px 20px 14px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--danger-bg)', color: 'var(--danger-fg)',
            }}><Trash2 size={16} /></span>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Delete User</h3>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
          }}><X size={18} /></button>
        </header>

        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 14 }}>
            Are you sure you want to delete:
          </p>
          <div style={{
            background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '12px 14px', fontSize: 13,
          }}>
            <Row label="Name" value={user.name || '—'} />
            <Row label="Email" value={user.email} mono />
            <Row label="Role" value={user.role} />
          </div>

          <div style={{
            marginTop: 14,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.30)',
            borderRadius: 10, padding: '10px 12px',
            fontSize: 13, color: 'var(--danger)',
          }}>
            <AlertTriangle size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
            This user will be permanently removed. Their audit history will be preserved (soft delete).
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{
              display: 'block',
              fontSize: 12, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--text-secondary)',
            }}>Type "DELETE" to confirm</label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              className="fp-input"
              style={{ marginTop: 6, height: 40, fontFamily: 'ui-monospace, monospace' }}
            />
          </div>

          {err && (
            <div style={{
              marginTop: 12, padding: '10px 12px',
              background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.40)',
              borderRadius: 8, fontSize: 13, color: 'var(--danger)',
            }}>{err}</div>
          )}
        </div>

        <footer style={{
          padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <button
            disabled={!enabled}
            onClick={confirm}
            style={{
              padding: '8px 16px', borderRadius: 10,
              fontSize: 13, fontWeight: 600,
              cursor: enabled ? 'pointer' : 'not-allowed',
              background: enabled ? '#991B1B' : 'var(--bg-tertiary)',
              color: enabled ? '#FFFFFF' : 'var(--text-tertiary)',
              border: enabled ? '1px solid #991B1B' : '1px solid var(--border)',
              transition: 'all 150ms',
            }}
          >
            {busy ? 'Deleting…' : 'Delete User'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '3px 0' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}:</span>
      <span style={{
        color: 'var(--text-primary)', fontWeight: 500,
        fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
      }}>{value}</span>
    </div>
  );
}

// ━━━ Create / Edit user form ─────────────────────────────
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
        <div className="col-span-2"><Label>Email</Label><Input type="email" value={form.email || ''} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required /></div>
        <div><Label>Name</Label><Input value={form.name || ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div><Label>Role</Label><Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>{ROLES.map((r) => <option key={r}>{r}</option>)}</Select></div>
        {form.role === 'client_user' && (
          <div className="col-span-2"><Label>Linked client (required)</Label><Select value={form.client_id || ''} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}><option value="">— Select —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        )}
        <div><Label>Phone</Label><Input value={form.phone || ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
        {!user && <div className="col-span-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>A temporary password will be generated and emailed.</div>}
      </div>
    </Modal>
  );
}
