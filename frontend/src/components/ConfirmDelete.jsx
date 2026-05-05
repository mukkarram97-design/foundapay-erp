import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button, money, dateOnly } from './ui';
import { api } from '../utils/api';
import { toast } from '../store/toast';

// Generic delete confirmation — requires typing "DELETE" to enable button.
// `target` can be a single tx (object) OR { ids, total, count } for bulk.
export default function ConfirmDelete({ target, mode = 'single', onClose, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const enabled = typed.trim() === 'DELETE' && !busy;

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      if (mode === 'bulk') {
        const r = await api.post('/api/transactions/bulk-delete', { ids: target.ids });
        toast.success(`Deleted ${r.deleted.length} transaction${r.deleted.length === 1 ? '' : 's'}`);
        onDeleted?.(r.deleted);
      } else {
        const r = await api.delete(`/api/transactions/${target.id}`);
        toast.success(`Transaction #${r.id} deleted`);
        onDeleted?.([r.id]);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)',
        zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      className="fp-fade-in"
    >
      <div
        className="fp-card fp-slide-up"
        style={{ width: '100%', maxWidth: 480, padding: 0 }}
      >
        <header style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '18px 20px 14px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--danger-bg)', color: 'var(--danger-fg)',
            }}>
              <AlertTriangle size={16} />
            </span>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
              {mode === 'bulk'
                ? `Delete ${target.count} Transactions`
                : `Delete Transaction #${target.id}`}
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
          ><X size={18} /></button>
        </header>

        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 14 }}>
            You are about to permanently delete:
          </p>

          {mode === 'single' ? (
            <div style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '12px 14px',
              fontSize: 13,
            }}>
              <Row label="Client" value={target.client_name || target.counterparty_name || '—'} />
              <Row label="Amount" value={`${money(target.gross_amount)} (${target.type})`} />
              <Row label="Date" value={dateOnly(target.date_received)} />
              {target.payment_method && <Row label="Method" value={target.payment_method} />}
            </div>
          ) : (
            <div style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '12px 14px',
              fontSize: 13,
            }}>
              <Row label="Selected" value={`${target.count} transactions`} />
              <Row label="Total amount" value={money(target.total)} />
              <Row label="IDs" value={target.ids.slice(0, 8).map((id) => `#${id}`).join(', ') + (target.ids.length > 8 ? `… (+${target.ids.length - 8})` : '')} />
            </div>
          )}

          <div style={{
            marginTop: 14,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.30)',
            borderRadius: 10, padding: '10px 12px',
            fontSize: 13, color: 'var(--danger)',
          }}>
            ⚠ This action <strong>cannot be undone</strong>. Records will be removed from the ledger and an audit log entry will be created.
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
              Type "DELETE" to confirm
            </label>
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
            {busy ? 'Deleting…' : 'Permanently Delete'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '3px 0' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}:</span>
      <span style={{ color: 'var(--text-primary)', fontFamily: 'ui-monospace, monospace', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
