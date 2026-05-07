// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GlobalSearch — top-bar omnisearch.
//
// Notes:
//   - Theme flicker fix: we explicitly skip ALL transitions on the
//     dropdown's first paint after mount. We only allow CSS transitions
//     after the user has interacted (focused / typed) once. This kills
//     the 1-frame paint where the wrong theme styles apply.
//   - Debounce 300ms; min 2 chars.
//   - Backend (/api/global-search) now returns 7 groups: transactions,
//     paymentLinks, invoices, vtTransactions, clients, entities, cards.
//   - Filter chips collapse the result set to a single category.
//   - Keyboard nav: ↑/↓ to move between rows, Enter to open, Esc to close.
//   - Recent searches: last 5 in localStorage; shown when input empty.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, X, Clock, FileSpreadsheet, Link as LinkIcon,
  CreditCard, Building2, Receipt, Users,
} from 'lucide-react';
import { api } from '../../utils/api';
import { Badge, money, dateOnly } from './index';

const RECENT_KEY = 'fp_recent_searches_v1';
const FILTERS = [
  { id: 'all',          label: 'All' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'paymentLinks', label: 'Links' },
  { id: 'invoices',     label: 'Invoices' },
  { id: 'vtTransactions', label: 'VT' },
  { id: 'clients',      label: 'Clients' },
];

const EMPTY = {
  transactions: [], paymentLinks: [], invoices: [], vtTransactions: [],
  clients: [], entities: [], cards: [],
};

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}
function saveRecent(query) {
  if (!query || query.length < 2) return;
  const list = loadRecent().filter((s) => s !== query);
  list.unshift(query);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
}

export default function GlobalSearch() {
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [highlight, setHighlight] = useState(-1);
  const [interacted, setInteracted] = useState(false); // gates CSS transitions
  const [recent, setRecent] = useState(() => loadRecent());
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''));
  }, []);

  // Cmd/Ctrl + K shortcut + Esc
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setInteracted(true);
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced search
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(EMPTY);
      setHighlight(-1);
      return;
    }
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get(`/api/global-search?q=${encodeURIComponent(q.trim())}`);
        // Normalize older API shape (transactions/clients/entities/cards) — ignore
        // missing groups gracefully.
        setResults({
          transactions:   r.transactions    || [],
          paymentLinks:   r.paymentLinks    || [],
          invoices:       r.invoices        || [],
          vtTransactions: r.vtTransactions  || [],
          clients:        r.clients         || [],
          entities:       r.entities        || [],
          cards:          r.cards           || [],
        });
        setHighlight(-1);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  // Flat list for keyboard nav (respects current filter)
  const flat = useMemo(() => {
    const visible = (k) => filter === 'all' || filter === k;
    const out = [];
    if (visible('transactions'))   results.transactions.forEach((r) => out.push({ kind: 'transactions', row: r }));
    if (visible('paymentLinks'))   results.paymentLinks.forEach((r) => out.push({ kind: 'paymentLinks', row: r }));
    if (visible('invoices'))       results.invoices.forEach((r) => out.push({ kind: 'invoices', row: r }));
    if (visible('vtTransactions')) results.vtTransactions.forEach((r) => out.push({ kind: 'vtTransactions', row: r }));
    if (visible('clients'))        results.clients.forEach((r) => out.push({ kind: 'clients', row: r }));
    if (filter === 'all') {
      results.entities.forEach((r) => out.push({ kind: 'entities', row: r }));
      results.cards.forEach((r) => out.push({ kind: 'cards', row: r }));
    }
    return out;
  }, [results, filter]);

  const totalVisible = flat.length;

  function openResult(item) {
    saveRecent(q.trim());
    setRecent(loadRecent());
    setOpen(false);
    setQ('');
    if (item.kind === 'transactions')   navigate(`/transactions?tx=${item.row.id}`);
    else if (item.kind === 'paymentLinks')   navigate(`/payment-links?q=${encodeURIComponent(item.row.invoice_number || item.row.token || '')}`);
    else if (item.kind === 'invoices')       navigate('/invoices');
    else if (item.kind === 'vtTransactions') navigate('/virtual-terminal');
    else if (item.kind === 'clients')        navigate('/clients');
    else if (item.kind === 'entities')       navigate('/entities');
    else if (item.kind === 'cards')          navigate('/cards');
  }

  function onInputKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(totalVisible - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(-1, h - 1));
    } else if (e.key === 'Enter') {
      const item = flat[highlight];
      if (item) {
        e.preventDefault();
        openResult(item);
      } else if (q.trim().length >= 2) {
        // Default behavior: stay open, no navigation
      }
    }
  }

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
        onChange={(e) => { setQ(e.target.value); setOpen(true); setInteracted(true); }}
        onFocus={() => { setOpen(true); setInteracted(true); }}
        onKeyDown={onInputKeyDown}
        placeholder="Search transactions, links, invoices…"
        spellCheck={false}
        autoComplete="off"
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
          // No transitions until user interacts → kills theme flicker
          transition: interacted ? 'border-color 150ms, box-shadow 150ms' : 'none',
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
      {q && (
        <button
          onClick={() => { setQ(''); inputRef.current?.focus(); }}
          aria-label="Clear"
          style={{
            position: 'absolute', right: 36, top: '50%', transform: 'translateY(-50%)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', padding: 2,
          }}
        ><X size={12} /></button>
      )}
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

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 mt-2 fp-card z-50 max-h-[60vh] overflow-y-auto"
            style={{
              transition: interacted ? 'opacity 150ms ease' : 'none',
              minWidth: 360,
            }}
          >
            {/* Filter chips (only when there's a query) */}
            {q.trim().length >= 2 && (
              <div style={{
                display: 'flex', gap: 4, padding: '8px 10px',
                borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
              }}>
                {FILTERS.map((f) => {
                  const cnt = f.id === 'all'
                    ? Object.values(results).reduce((s, arr) => s + arr.length, 0)
                    : (results[f.id] || []).length;
                  if (f.id !== 'all' && cnt === 0) return null;
                  return (
                    <button
                      key={f.id}
                      onClick={() => { setFilter(f.id); setHighlight(-1); }}
                      style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 6,
                        background: filter === f.id ? 'var(--accent-dim)' : 'transparent',
                        color: filter === f.id ? 'var(--accent)' : 'var(--text-secondary)',
                        border: '1px solid ' + (filter === f.id ? 'var(--accent)' : 'var(--border)'),
                        cursor: 'pointer', fontWeight: 500,
                      }}
                    >
                      {f.label} {cnt > 0 && <span style={{ opacity: 0.7 }}>· {cnt}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Recent searches when input is empty */}
            {q.trim().length < 2 && recent.length > 0 && (
              <div>
                <SectionHeader>Recent</SectionHeader>
                {recent.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setQ(s); inputRef.current?.focus(); }}
                    className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm"
                    style={{ color: 'var(--text-primary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Clock size={12} style={{ color: 'var(--text-tertiary)' }} />
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Empty state */}
            {q.trim().length < 2 && recent.length === 0 && (
              <div className="p-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Start typing to search transactions, links, invoices, clients…
              </div>
            )}

            {/* Loading */}
            {q.trim().length >= 2 && loading && (
              <div className="p-4 text-xs" style={{ color: 'var(--text-secondary)' }}>Searching…</div>
            )}

            {/* No results */}
            {q.trim().length >= 2 && !loading && totalVisible === 0 && (
              <div className="p-4 text-xs" style={{ color: 'var(--text-secondary)' }}>No results for "{q}"</div>
            )}

            {/* Results, grouped */}
            {q.trim().length >= 2 && !loading && totalVisible > 0 && (
              <ResultGroups
                results={results}
                filter={filter}
                flat={flat}
                highlight={highlight}
                onPick={openResult}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ResultGroups({ results, filter, flat, highlight, onPick }) {
  // We render each group in order, but compute the running global index so
  // keyboard highlight maps to the right row.
  let globalIdx = 0;
  const sections = [];
  const visible = (k) => filter === 'all' || filter === k;

  function pushSection(kind, title, Icon, rows, render) {
    if (!visible(kind) || rows.length === 0) return;
    sections.push(
      <div key={kind}>
        <SectionHeader>
          <Icon size={11} style={{ marginRight: 6, opacity: 0.7 }} />
          {title} <span style={{ opacity: 0.5, marginLeft: 4 }}>· {rows.length}</span>
        </SectionHeader>
        {rows.map((r) => {
          const idx = globalIdx++;
          return (
            <Result
              key={`${kind}-${r.id}`}
              isActive={idx === highlight}
              onClick={() => onPick(flat[idx])}
            >
              {render(r)}
            </Result>
          );
        })}
      </div>
    );
  }

  pushSection('transactions',   'Transactions',     Receipt, results.transactions, (t) => (
    <>
      <span className="font-mono text-xs opacity-60">#{t.id}</span>
      <span className="flex-1 truncate">{t.counterparty_name || '—'}</span>
      <span className="font-mono">{money(t.gross_amount)}</span>
      <span className="text-xs opacity-60">{dateOnly(t.date_received)}</span>
      <Badge tone={t.status === 'Completed' ? 'green' : t.status === 'Hold' ? 'amber' : 'zinc'}>{t.status}</Badge>
    </>
  ));
  pushSection('paymentLinks',   'Payment Links',    LinkIcon, results.paymentLinks, (p) => (
    <>
      <span className="font-mono text-xs opacity-70">{p.invoice_number || (p.token ? p.token.slice(0, 8) : '—')}</span>
      <span className="flex-1 truncate">{p.customer_name || p.customer_email || p.client_name || p.description || '—'}</span>
      <span className="font-mono">{money(p.amount)}</span>
      <Badge tone={p.status === 'paid' ? 'green' : p.status === 'cancelled' ? 'red' : 'amber'}>
        {p.status === 'paid' ? 'Paid' : p.status === 'cancelled' ? 'Cancelled' : 'Pending'}
      </Badge>
    </>
  ));
  pushSection('invoices',       'Invoices',         FileSpreadsheet, results.invoices, (inv) => (
    <>
      <span className="font-mono text-xs opacity-70">{inv.invoice_number}</span>
      <span className="flex-1 truncate">{inv.customer_name || inv.customer_email || inv.client_name || '—'}</span>
      <span className="font-mono">{money(inv.total_amount)}</span>
      <span className="text-xs opacity-60">{dateOnly(inv.issue_date)}</span>
    </>
  ));
  pushSection('vtTransactions', 'VT (Direct charge)', CreditCard, results.vtTransactions, (vt) => (
    <>
      <span className="font-mono text-xs opacity-70">{vt.invoice_number || vt.processor_transaction_id?.slice(0, 10) || '—'}</span>
      <span className="flex-1 truncate">{vt.card_holder_name || '—'}</span>
      <span className="font-mono">{money(vt.amount)}</span>
      <Badge tone={vt.status === 'success' ? 'green' : vt.status === 'declined' ? 'red' : 'amber'}>{vt.status}</Badge>
    </>
  ));
  pushSection('clients',        'Clients',          Users, results.clients, (c) => (
    <>
      <span className="flex-1 font-medium truncate">{c.name}</span>
      {c.email && <span className="text-xs opacity-60 truncate">{c.email}</span>}
      <Badge tone={c.status === 'active' ? 'green' : 'zinc'}>{c.status}</Badge>
    </>
  ));
  if (filter === 'all') {
    pushSection('entities', 'Entities', Building2, results.entities, (e) => (
      <>
        <span className="flex-1 font-medium truncate">{e.legal_name}</span>
        <span className="text-xs opacity-60 truncate">{e.owner_name || '—'}</span>
      </>
    ));
    pushSection('cards', 'Cards', CreditCard, results.cards, (c) => (
      <>
        <span className="flex-1 font-medium truncate">{c.nickname}</span>
        <span className="font-mono text-xs opacity-70">••{c.last4}</span>
        <span className="text-xs opacity-60 truncate">{c.bank_name}</span>
      </>
    ));
  }

  return <>{sections}</>;
}

function SectionHeader({ children }) {
  return (
    <div
      className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}
    >{children}</div>
  );
}

function Result({ isActive, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm"
      style={{
        color: 'var(--text-primary)',
        background: isActive ? 'var(--bg-hover)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? 'var(--bg-hover)' : 'transparent'; }}
    >
      {children}
    </button>
  );
}
