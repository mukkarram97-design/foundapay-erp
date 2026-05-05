import React, { useEffect, useMemo, useState } from 'react';
import { LogIn, LogOut, ShieldAlert, Search } from 'lucide-react';
import { api } from '../utils/api';
import { Card, Input, Select, PageHeader, Alert, Badge, relativeTime } from '../components/ui';

const STATUS_TONE_COLOR = {
  success: 'var(--success)',
  logout: 'var(--text-tertiary)',
  failed_password: 'var(--danger)',
  failed_no_user: 'var(--danger)',
};
const ACTION_COLOR = {
  GET: 'var(--success)',
  POST: 'var(--info)',
  PATCH: 'var(--warning)',
  DELETE: 'var(--danger)',
  AUTH: 'var(--accent)',
};

export default function Audit() {
  const [data, setData] = useState({ rows: [], login_history: [] });
  const [err, setErr] = useState(null);
  const [filterUser, setFilterUser] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/api/audit').then(setData).catch((e) => setErr(e.message));
  }, []);

  // Combine login_history into the timeline as auth events
  const events = useMemo(() => {
    const fromAudit = (data.rows || []).map((r) => ({
      id: `a-${r.id}`,
      kind: 'audit',
      action: r.action,
      color: ACTION_COLOR[r.action] || 'var(--accent)',
      title: `${r.user_name || r.user_email || 'Someone'} ${r.action.toLowerCase()} ${r.resource}${r.resource_id ? ` #${r.resource_id}` : ''}`,
      ip: r.ip_address,
      created_at: r.created_at,
    }));
    const fromLogin = (data.login_history || []).map((r) => ({
      id: `l-${r.id}`,
      kind: 'auth',
      action: 'AUTH',
      color: r.status === 'success' ? 'var(--accent)' : 'var(--danger)',
      title: `${r.user_email || 'Unknown user'} ${r.status === 'logout' ? 'logged out' : r.status === 'success' ? 'signed in' : 'failed sign-in'}`,
      ip: r.ip_address,
      status: r.status,
      created_at: r.created_at,
    }));
    return [...fromAudit, ...fromLogin].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [data]);

  const filtered = events.filter((e) => {
    if (filterUser && !e.title.toLowerCase().includes(filterUser.toLowerCase())) return false;
    if (filterAction && e.action !== filterAction) return false;
    if (search && !e.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Group by date
  const groups = useMemo(() => {
    const byDay = {};
    for (const e of filtered) {
      const d = new Date(e.created_at);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const key = d.toDateString() === today.toDateString() ? 'Today'
                : d.toDateString() === yesterday.toDateString() ? 'Yesterday'
                : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      (byDay[key] ||= []).push(e);
    }
    return byDay;
  }, [filtered]);

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <PageHeader title="Audit Logs" subtitle={`${filtered.length} of ${events.length} events`} />
      {err && <Alert tone="error" className="mb-4">{err}</Alert>}

      <Card className="p-3 mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <Input className="pl-9" placeholder="Search title or user..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
          <option value="">All actions</option>
          <option>GET</option><option>POST</option><option>PATCH</option><option>DELETE</option><option>AUTH</option>
        </Select>
        <Input placeholder="Filter by user name/email..." value={filterUser} onChange={(e) => setFilterUser(e.target.value)} />
      </Card>

      {Object.entries(groups).map(([day, items]) => (
        <div key={day} className="mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>{day}</h3>
          <div className="relative pl-6">
            {/* timeline rail */}
            <div className="absolute left-2 top-1 bottom-1 w-px" style={{ background: 'var(--border)' }} />
            {items.map((e) => {
              const Icon = e.action === 'AUTH'
                ? (e.status === 'success' ? LogIn : e.status === 'logout' ? LogOut : ShieldAlert)
                : null;
              return (
                <div key={e.id} className="relative mb-3">
                  <span
                    className="absolute -left-[18px] top-1.5 rounded-full"
                    style={{ width: 9, height: 9, background: e.color, border: '2px solid var(--bg-primary)' }}
                  />
                  <div className="flex items-center gap-3 text-xs">
                    <Badge tone={e.action === 'GET' ? 'success' : e.action === 'POST' ? 'info' : e.action === 'PATCH' ? 'warning' : e.action === 'DELETE' ? 'danger' : 'accent'}>{e.action}</Badge>
                    <span className="text-sm flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                      {Icon && <Icon size={12} style={{ color: e.color }} />}
                      {e.title}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)' }}>· {relativeTime(e.created_at)}</span>
                    {e.ip && <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>· {e.ip}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <Card className="p-12 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          No audit events match your filters.
        </Card>
      )}
    </div>
  );
}
