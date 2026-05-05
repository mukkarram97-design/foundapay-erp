import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../../utils/api';
import { Badge, money, dateOnly } from './index';

export default function GlobalSearch() {
  const inputRef = useRef(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState({ transactions: [], clients: [], entities: [], cards: [] });
  const [loading, setLoading] = useState(false);
  const [isMac, setIsMac] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''));
  }, []);

  // Cmd/Ctrl + K shortcut
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounce search
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults({ transactions: [], clients: [], entities: [], cards: [] });
      return;
    }
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get(`/api/global-search?q=${encodeURIComponent(q)}`);
        setResults(r);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const total =
    results.transactions.length + results.clients.length +
    results.entities.length + results.cards.length;

  function open$(path) { setOpen(false); setQ(''); navigate(path); }

  return (
    <div className="relative w-full" style={{ maxWidth: 400 }}>
      <Search
        size={14}
        style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-tertiary)',
          pointerEvents: 'none',
        }}
      />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search transactions, clients, cards..."
        style={{
          width: '100%',
          height: 36,
          background: 'var(--input-bg)',
          border: '1px solid var(--input-border)',
          borderRadius: 10,
          padding: '8px 40px 8px 36px',
          fontSize: 13,
          color: 'var(--input-text)',
          outline: 'none',
          transition: 'border-color 150ms, box-shadow 150ms',
        }}
        onFocusCapture={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
          e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-dim)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--input-border)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
      <kbd
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'var(--bg-hover)',
          border: '1px solid var(--border)',
          borderRadius: 5,
          padding: '2px 5px',
          fontSize: 10,
          fontFamily: 'monospace',
          color: 'var(--text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          pointerEvents: 'none',
          lineHeight: 1,
        }}
      >
        {isMac ? '⌘K' : 'Ctrl+K'}
      </kbd>

      {open && q.trim().length >= 2 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 right-0 mt-2 fp-card fp-slide-up z-50 max-h-[60vh] overflow-y-auto"
          >
            {loading && <div className="p-4 text-xs" style={{ color: 'var(--text-secondary)' }}>Searching…</div>}
            {!loading && total === 0 && (
              <div className="p-4 text-xs" style={{ color: 'var(--text-secondary)' }}>No results for "{q}"</div>
            )}

            {results.transactions.length > 0 && (
              <Section title="Transactions">
                {results.transactions.map((t) => (
                  <Result key={`tx-${t.id}`} onClick={() => open$('/transactions')}>
                    <span className="font-mono text-xs opacity-60">#{t.id}</span>
                    <span className="flex-1 truncate">{t.counterparty_name || '—'}</span>
                    <span className="font-mono">{money(t.gross_amount)}</span>
                    <span className="text-xs opacity-60">{dateOnly(t.date_received)}</span>
                    <Badge tone={t.status === 'Completed' ? 'green' : t.status === 'Hold' ? 'amber' : 'zinc'}>{t.status}</Badge>
                  </Result>
                ))}
              </Section>
            )}

            {results.clients.length > 0 && (
              <Section title="Clients">
                {results.clients.map((c) => (
                  <Result key={`cl-${c.id}`} onClick={() => open$('/clients')}>
                    <span className="flex-1 font-medium truncate">{c.name}</span>
                    <span className="font-mono text-xs">{money(c.balance_owed)}</span>
                    <Badge tone={c.status === 'active' ? 'green' : 'zinc'}>{c.status}</Badge>
                  </Result>
                ))}
              </Section>
            )}

            {results.entities.length > 0 && (
              <Section title="Entities">
                {results.entities.map((e) => (
                  <Result key={`en-${e.id}`} onClick={() => open$('/entities')}>
                    <span className="flex-1 font-medium truncate">{e.legal_name}</span>
                    <span className="text-xs opacity-60 truncate">{e.owner_name || '—'}</span>
                  </Result>
                ))}
              </Section>
            )}

            {results.cards.length > 0 && (
              <Section title="Cards">
                {results.cards.map((c) => (
                  <Result key={`cd-${c.id}`} onClick={() => open$('/cards')}>
                    <span className="flex-1 font-medium truncate">{c.nickname}</span>
                    <span className="font-mono text-xs opacity-70">••{c.last4}</span>
                    <span className="text-xs opacity-60 truncate">{c.bank_name}</span>
                  </Result>
                ))}
              </Section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div
        className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-tertiary)' }}
      >{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Result({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm transition"
      style={{ color: 'var(--text-primary)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}
