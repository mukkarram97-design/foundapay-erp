import React, { useEffect, useState } from 'react';
import { TrendingDown, Users2, Building2 } from 'lucide-react';
import { api } from '../utils/api';
import {
  Card, PageHeader, Alert, Badge,
  Table, Thead, Th, Tr, Td, money, pct,
} from '../components/ui';

export default function Partners() {
  const [data, setData] = useState(null);
  const [waterfall, setWaterfall] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/api/partners'), api.get('/api/partners/waterfall')])
      .then(([p, w]) => { setData(p); setWaterfall(w); })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="p-6"><Alert tone="error">{err}</Alert></div>;
  if (!data) return <div className="p-6"><Card className="p-6" style={{ color: 'var(--text-secondary)' }}>Loading…</Card></div>;

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader title="Partners & Owner Settlement" subtitle="Q1 2026 profit distribution" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <KPI label="Q1 Gross Processed" value={money(data.q1_summary.gross)} />
        <KPI label="Q1 FP Revenue" value={money(data.q1_summary.revenue)} tone="success" />
        <KPI label="Q1 Net Profit" value={money(data.q1_summary.net_profit)} tone="success" />
      </div>

      {/* Waterfall */}
      {waterfall && (
        <Card className="p-5 mb-6">
          <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Profit distribution waterfall</h3>
          <div className="space-y-2">
            {waterfall.steps.map((s, i) => {
              const isNegative = parseFloat(s.value) < 0;
              const isOwner = s.owner;
              const isDivider = s.divider;
              return (
                <div key={i}>
                  <div
                    className="flex items-center justify-between py-2 px-3 rounded-lg"
                    style={{
                      background: isDivider ? 'var(--accent-dim)' : isOwner ? 'var(--bg-tertiary)' : 'transparent',
                      borderLeft: isOwner ? '3px solid var(--accent)' : 'none',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {isNegative && <TrendingDown size={14} style={{ color: 'var(--danger)' }} />}
                      <span
                        className={isDivider ? 'font-semibold' : ''}
                        style={{ color: isOwner ? 'var(--accent)' : 'var(--text-primary)' }}
                      >{s.label}</span>
                    </div>
                    <span
                      className="font-mono"
                      style={{
                        color: isNegative ? 'var(--danger)' : isOwner ? 'var(--accent)' : 'var(--text-primary)',
                        fontWeight: isDivider || isOwner ? 600 : 400,
                      }}
                    >{money(s.value)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Owners */}
      <Card className="overflow-hidden mb-6">
        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
          <Users2 size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Owners (equity holders)</h3>
        </div>
        <Table>
          <Thead>
            <Tr><Th>Owner</Th><Th className="text-right">Share</Th><Th className="text-right">Q1 entitled</Th><Th className="text-right">Drawn</Th><Th className="text-right">Balance owed</Th><Th>Status</Th></Tr>
          </Thead>
          <tbody>
            {data.owners.map((o) => (
              <Tr key={o.id}>
                <Td className="font-medium">{o.name}</Td>
                <Td className="text-right font-mono">{pct(o.share_pct)}</Td>
                <Td className="text-right font-mono">{money(o.q1_entitled)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{money(o.total_drawn)}</Td>
                <Td className="text-right font-mono" style={{ color: parseFloat(o.balance_owed) > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>{money(o.balance_owed)}</Td>
                <Td><Badge tone={o.status === 'active' ? 'success' : 'neutral'}>{o.status}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Partners (per-company 10%) */}
      <Card className="overflow-hidden">
        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
          <Building2 size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Per-company partners (10% share)</h3>
        </div>
        <Table>
          <Thead>
            <Tr><Th>Partner</Th><Th>Companies</Th><Th className="text-right">April revenue</Th><Th className="text-right">10% entitled</Th></Tr>
          </Thead>
          <tbody>
            {data.partners.map((p, i) => (
              <Tr key={i}>
                <Td className="font-medium">{p.name}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {(p.entities || []).map((e) => (
                      <span key={e.id} className="fp-badge fp-badge-neutral">{e.legal_name}</span>
                    ))}
                  </div>
                </Td>
                <Td className="text-right font-mono">{money(p.april_revenue)}</Td>
                <Td className="text-right font-mono" style={{ color: 'var(--success)' }}>{money(p.april_entitled)}</Td>
              </Tr>
            ))}
            {data.partners.length === 0 && <Tr><Td colSpan="4" style={{ color: 'var(--text-secondary)' }}>No per-company partners assigned to entities yet.</Td></Tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function KPI({ label, value, tone = 'default' }) {
  const colors = { default: 'var(--text-primary)', success: 'var(--success)' };
  return (
    <Card className="p-5">
      <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="text-2xl font-semibold" style={{ color: colors[tone] }}>{value}</div>
    </Card>
  );
}
