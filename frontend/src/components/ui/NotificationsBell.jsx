import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, AlertTriangle, CreditCard, Calendar, Wallet } from 'lucide-react';
import { api } from '../../utils/api';
import { relativeTime } from './index';

const ICON_FOR = {
  chargeback: AlertTriangle,
  card_limit: CreditCard,
  renewal: Calendar,
  payout_approval: Wallet,
};

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const navigate = useNavigate();

  // Poll every 30s
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await api.get('/api/notifications');
        if (!alive) return;
        setItems(r.rows || []);
        setCount((r.rows || []).filter((n) => !n.read).length);
      } catch { /* ignore */ }
    }
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Click outside to close
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function handleClick(n) {
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  async function markAllRead() {
    try { await api.post('/api/notifications/mark-all-read', {}); } catch { /* ignore */ }
    setCount(0);
    setItems(items.map((i) => ({ ...i, read: true })));
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Notifications"
        style={{
          width: 36, height: 36,
          borderRadius: 8,
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'background 150ms',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <Bell size={18} />
        {count > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 6, right: 6,
              minWidth: 16, height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: 'var(--danger)',
              color: 'white',
              fontSize: 10,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 fp-card fp-slide-up z-50"
          style={{ width: 380, maxHeight: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <h4 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Notifications</h4>
            <button onClick={markAllRead} className="text-xs opacity-70 hover:opacity-100" style={{ color: 'var(--accent)' }}>
              Mark all read
            </button>
          </div>
          <div className="overflow-y-auto flex-1">
            {items.length === 0 && (
              <div className="p-8 text-center">
                <Check size={32} className="mx-auto opacity-40 mb-2" style={{ color: 'var(--success)' }} />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>You're all caught up!</p>
              </div>
            )}
            {items.map((n) => {
              const Icon = ICON_FOR[n.type] || Bell;
              const tone = n.tone === 'danger' ? 'var(--danger)' : n.tone === 'warning' ? 'var(--warning)'
                          : n.tone === 'accent' ? 'var(--accent)' : 'var(--info)';
              return (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className="w-full text-left flex gap-3 px-4 py-3 border-l-2 transition"
                  style={{
                    borderLeftColor: tone,
                    borderBottom: '1px solid var(--border-light)',
                    background: n.read ? 'transparent' : 'var(--bg-tertiary)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = n.read ? 'transparent' : 'var(--bg-tertiary)'; }}
                >
                  <Icon size={16} style={{ color: tone, marginTop: 2 }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{n.title}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{n.message}</div>
                    <div className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>{relativeTime(n.created_at)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
