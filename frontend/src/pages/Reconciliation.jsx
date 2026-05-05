import React, { useState } from 'react';
import { Card, Button, Select, PageHeader, Badge, Table, Thead, Th, Tr, Td } from '../components/ui';

const STATUS = ['matched','partial','difference','missing','needs_review'];

export default function Reconciliation() {
  const [status, setStatus] = useState('');

  // Phase 2 ships the schema + filter shell. Reconciliation batch creation
  // (CSV import + matching engine) lands in a follow-up.
  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <PageHeader title="Reconciliation" subtitle="Match bank, processor, and ledger entries" />

      <Card className="p-3 mb-4 flex items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-56">
          <option value="">All statuses</option>
          {STATUS.map(s => <option key={s}>{s}</option>)}
        </Select>
        <Button variant="secondary">Upload bank CSV</Button>
        <Button variant="secondary">Upload processor CSV</Button>
      </Card>

      <Card className="p-8 text-[var(--text-tertiary)] text-sm">
        No reconciliation batches yet. Use <span className="text-[var(--text-secondary)]">Upload bank CSV</span> or
        <span className="text-[var(--text-secondary)]"> Upload processor CSV</span> to start matching.
        <div className="mt-3 text-xs">Status legend:&nbsp;
          {STATUS.map(s => <Badge key={s} tone={s === 'matched' ? 'green' : s === 'difference' ? 'red' : s === 'missing' ? 'amber' : 'blue'} className="mr-1">{s}</Badge>)}
        </div>
      </Card>
    </div>
  );
}
