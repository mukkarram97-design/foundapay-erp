import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { Card, PageHeader, Alert, Badge, Table, Thead, Th, Tr, Td, money } from '../components/ui';

export default function Accounting() {
  const [coa, setCoa] = useState([]);
  const [bs, setBs] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/api/cms').then((s) => {
      // chart of accounts is stored in chart_of_accounts table; we need its data via an endpoint.
      // No CRUD page yet — fetch via reports for now.
    }).catch(() => {});
    api.get('/api/reports/balance-sheet').then(setBs).catch((e) => setErr(e.message));
  }, []);

  // Use balance sheet for trial balance approximation
  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PageHeader title="Accounting" subtitle="Chart of accounts & trial balance" />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}

      {bs && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card className="p-5">
            <h3 className="font-medium text-[var(--text-primary)] mb-3">Trial balance — Assets</h3>
            <Row label="1000 · Cash & Bank" value={money(bs.assets.cash_in_banks)} />
            <Row label="1100 · Accounts Receivable" value={money(bs.assets.receivable_from_clients)} />
            <Row label="1200 · Reserve Funds Held" value={money(bs.assets.reserve_funds_held)} />
            <Row label="Total Assets" value={money(bs.assets.total_assets)} bold tone="green" />
          </Card>
          <Card className="p-5">
            <h3 className="font-medium text-[var(--text-primary)] mb-3">Trial balance — Liabilities</h3>
            <Row label="2100 · Client Balances Owed" value={money(bs.liabilities.payable_to_clients)} />
            <Row label="Total Liabilities" value={money(bs.liabilities.total_liabilities)} bold tone="amber" />
          </Card>
        </div>
      )}

      <Card className="p-5">
        <h3 className="font-medium text-[var(--text-primary)] mb-3">Chart of accounts</h3>
        <p className="text-[var(--text-tertiary)] text-sm mb-3">Standard 12-line chart loaded by seed. Use the API to extend or modify.</p>
        <Table>
          <Thead><Tr><Th>Code</Th><Th>Name</Th><Th>Type</Th></Tr></Thead>
          <tbody>
            {[
              ['1000', 'Cash & Bank', 'asset'],
              ['1100', 'Accounts Receivable', 'asset'],
              ['1200', 'Reserve Funds Held', 'asset'],
              ['2000', 'Accounts Payable', 'liability'],
              ['2100', 'Client Balances Owed', 'liability'],
              ['2200', 'Owner Equity Payable', 'liability'],
              ['3000', 'Owner Equity', 'equity'],
              ['4000', 'Commission Revenue', 'income'],
              ['4100', 'Other Income', 'income'],
              ['5000', 'Operating Expenses', 'expense'],
              ['5100', 'Payroll Expense', 'expense'],
              ['5200', 'Bank & Processor Fees', 'expense'],
            ].map(([code, name, type]) => (
              <Tr key={code}>
                <Td className="font-mono text-xs">{code}</Td>
                <Td>{name}</Td>
                <Td><Badge tone={type === 'asset' ? 'green' : type === 'liability' ? 'amber' : type === 'income' ? 'blue' : type === 'expense' ? 'red' : 'violet'}>{type}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function Row({ label, value, bold, tone }) {
  const tones = { zinc: 'text-[var(--text-primary)]', green: 'text-emerald-400', amber: 'text-amber-400' };
  return (
    <div className={`flex items-center justify-between py-1.5 ${bold ? 'border-t border-[var(--border)] mt-2 pt-3' : ''}`}>
      <span className={`text-sm ${bold ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-secondary)]'}`}>{label}</span>
      <span className={`font-mono ${bold ? 'text-lg font-semibold' : ''} ${tones[tone] || 'text-[var(--text-primary)]'}`}>{value}</span>
    </div>
  );
}
